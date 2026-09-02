/* ============================================
   Map — Leaflet + clusters
   Taille des marqueurs = capacité · couleur = type
   Légende dynamique et interactive
   ============================================ */

const MapView = (() => {
  const { PALETTE, fmtNum, fmtDate, escapeHtml, typeColor, CAP_UNITS } = CONFIG;

  const FRANCE_BOUNDS = L.latLngBounds([47.2, 5.8], [55.1, 15.1]);

  let map;
  let clusterGroup;
  let legendDiv;
  // légende repliée par défaut sur petit écran (elle couvrirait la carte)
  let legendCollapsed = window.matchMedia('(max-width: 860px)').matches;
  const markers = new Map(); // id -> marker

  function init() {
    map = L.map('map', {
      center: FRANCE_BOUNDS.getCenter(),
      zoom: 6,
      // sur un écran de téléphone (carte ~300 px de haut), la France
      // entière demande un zoom < 5 : le plancher doit descendre à 4
      minZoom: 4,
      zoomControl: true,
      // pas de zoom fractionnaire : cadrage au plus juste sur la France
      zoomSnap: 0.25,
    });

    // (CARTO impose désormais une clé API — tuiles filigranées sinon.)
    // Même fond que biomethane-france : Esri, natif jusqu'au zoom 16.
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Fond de carte &copy; <a href="https://www.esri.com/">Esri</a> · Données &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxNativeZoom: 16,
      maxZoom: 19,
    }).addTo(map);

    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    // Bouton recentrer
    const recenter = L.control({ position: 'topleft' });
    recenter.onAdd = () => {
      const div = L.DomUtil.create('div', 'leaflet-bar');
      const a = L.DomUtil.create('a', '', div);
      a.href = '#';
      a.title = 'Recenter map (Germany)';
      a.setAttribute('aria-label', 'Recenter map (Germany)');
      a.innerHTML = '⌂';
      L.DomEvent.on(a, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        fitFrance();
      });
      return div;
    };
    recenter.addTo(map);

    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 46,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      chunkedLoading: true,
      iconCreateFunction: (cluster) => {
        const n = cluster.getChildCount();
        const size = n < 10 ? 30 : n < 100 ? 36 : 44;
        return L.divIcon({
          html: `<div class="cluster-icon">${n.toLocaleString('en-GB')}</div>`,
          className: 'marker-cluster',
          iconSize: [size, size],
        });
      },
    });
    map.addLayer(clusterGroup);

    addLegend();
    // vue d'entrée : la France entière, quelle que soit la taille de l'écran
    fitFrance();
  }

  function fitFrance() {
    if (map) map.fitBounds(FRANCE_BOUNDS, { padding: [10, 10] });
  }

  /* Rayon ∝ racine de la capacité en MW — étalonné sur la plage allemande :
     75 kW ≈ 4,5 px · 500 kW ≈ 5,7 px · 1,5 MW ≈ 7,6 px · 7 MW ≈ 13 px */
  function radiusFor(capacite) {
    if (!capacite || capacite <= 0) return 4.5;
    return Math.max(4.5, Math.min(13, 3 + Math.sqrt(capacite * 1000) * 0.12));
  }

  function createIcon(d) {
    const color = typeColor(d.type);
    const r = radiusFor(d.capacite);
    const size = r * 2;
    const isCogen = d.base === 'cogen';
    const shape = isCogen
      ? `border-radius: 3px; transform: rotate(45deg);`
      : `border-radius: 50%;`;
    return L.divIcon({
      className: 'site-marker',
      html: `<div style="width:${size}px;height:${size}px;background:${color};${shape}
        border:1.5px solid #fff;box-shadow:0 1px 3px rgba(30,66,96,0.4);
        ${d.ouvert ? '' : 'opacity:0.45;'}"></div>`,
      iconSize: [size, size],
      iconAnchor: [r, r],
      popupAnchor: [0, -r - 2],
    });
  }

  function popupHtml(d) {
    const unit = CAP_UNITS[d.base] || 'MW';
    const rows = [
      ['Type', d.type],
      ['Capacity', `${fmtNum(d.capacite, 2)} ${unit}`],
      ['Commissioned', fmtDate(d.dateMes)],
      ['Technology', d.reseau],
    ];
    if (d.base === 'cogen' && d.puissanceKw)
      rows.splice(2, 0, ['Output', `${fmtNum(d.puissanceKw, 0)} kW`]);
    if (d.base === 'cogen' && d.combustible)
      rows.splice(1, 0, ['Fuel', d.combustible]);
    if (d.echeanceAnnee != null)
      rows.push(['Support end (est.)', String(d.echeanceAnnee)]);

    const hypNote = d.echeanceHyp
      ? `<div class="legend-note">Assumption: ${escapeHtml(d.echeanceHyp)}</div>` : '';
    const geoNote = d.geoPrecision === 'commune'
      ? `<div class="legend-note">Position at municipality centre</div>` : '';
    const gmaps = (d.lat != null && d.lon != null)
      ? `<a class="popup-link" href="https://www.google.com/maps?q=${d.lat},${d.lon}"
           target="_blank" rel="noopener noreferrer">Google Maps ↗</a>` : '';

    return `
      <div class="popup-title">${escapeHtml(d.nom)}</div>
      <div class="popup-sub">${escapeHtml([d.commune, d.departement].filter(Boolean).join(' · '))}</div>
      <dl class="popup-grid">
        ${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v || '—'))}</dd>`).join('')}
      </dl>
      <div class="popup-foot">
        <span class="status-tag ${d.ouvert ? 'open' : 'closed'}">${d.ouvert ? 'Operating' : 'Closed'}</span>
        ${gmaps}
      </div>
      ${hypNote}${geoNote}`;
  }

  function update(data) {
    clusterGroup.clearLayers();
    markers.clear();

    const layer = [];
    data.forEach(d => {
      if (d.lat == null || d.lon == null) return;
      const marker = L.marker([d.lat, d.lon], {
        icon: createIcon(d),
        title: d.nom,
        alt: d.nom,
      });
      marker.bindPopup(popupHtml(d), { maxWidth: 300 });
      layer.push(marker);
      markers.set(d.id, marker);
    });
    clusterGroup.addLayers(layer);

    document.getElementById('map-empty').hidden = data.length > 0;
    updateLegend(data);
  }

  function focusOn(id) {
    const marker = markers.get(id);
    if (!marker) return;
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 12), { animate: true });
    clusterGroup.zoomToShowLayer(marker, () => marker.openPopup());
  }

  /* ---- Légende dynamique : types présents + effectifs, cliquable ---- */

  function addLegend() {
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => {
      legendDiv = L.DomUtil.create('div', 'map-legend');
      L.DomEvent.disableClickPropagation(legendDiv);
      L.DomEvent.disableScrollPropagation(legendDiv);
      return legendDiv;
    };
    legend.addTo(map);
  }

  function updateLegend(data) {
    if (!legendDiv) return;
    const counts = {};
    data.forEach(d => {
      counts[d.type] = (counts[d.type] || 0) + 1;
    });
    const types = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

    if (!types.length) { legendDiv.innerHTML = ''; return; }

    legendDiv.classList.toggle('collapsed', legendCollapsed);
    legendDiv.innerHTML = `
      <button class="map-legend-toggle" aria-expanded="${!legendCollapsed}"
              aria-label="Show or hide the legend">
        <span class="map-legend-title">Site types</span>
        <span class="chevron" aria-hidden="true">▼</span>
      </button>
      <div class="map-legend-body">
      ${types.map(t => {
        const diamond = ['Biogas', 'Biomethan (Bioerdgas)', 'Klärgas', 'Deponiegas'].includes(t) ? ' diamond' : '';
        const desc = CONFIG.TYPE_DESCRIPTIONS[t] || '';
        return `<div class="legend-item" data-type="${escapeHtml(t)}" role="button" tabindex="0"
             title="${escapeHtml(desc ? desc + ' — click to show / hide' : 'Click to show / hide this type')}">
          <span class="type-dot${diamond}" style="background:${typeColor(t)}"></span>
          <span class="type-name">${escapeHtml(t)}</span>
          <span class="type-count">${counts[t].toLocaleString('en-GB')}</span>
        </div>`;
      }).join('')}
      <div class="legend-note">◆ CHP · ● injection — dot size ∝ capacity (MW)</div>
      </div>`;

    legendDiv.querySelector('.map-legend-toggle').addEventListener('click', () => {
      legendCollapsed = !legendCollapsed;
      legendDiv.classList.toggle('collapsed', legendCollapsed);
      legendDiv.querySelector('.map-legend-toggle').setAttribute('aria-expanded', String(!legendCollapsed));
    });

    legendDiv.querySelectorAll('.legend-item').forEach(el => {
      const toggle = () => Filters.toggleType(el.dataset.type);
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  function invalidateSize() {
    if (map) map.invalidateSize();
  }

  // popupHtml exposé : réutilisé pour la fiche site (one-pager) et les tests
  return { init, update, focusOn, invalidateSize, fitFrance, popupHtml };
})();
