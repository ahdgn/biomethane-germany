/* ============================================
   Map — Leaflet + clusters
   Taille des marqueurs = capacité · couleur = type
   Légende dynamique et interactive
   ============================================ */

const MapView = (() => {
  const { PALETTE, fmtNum, fmtDate, escapeHtml, typeColor, CAP_UNITS } = CONFIG;

  const FRANCE_BOUNDS = L.latLngBounds([47.2, 5.8], [55.1, 15.1]);

  /* Emprises des Länder (précalculées depuis tools/geo/bundeslaender.geo.json)
     — sélectionner un Land recentre la carte dessus, vue complète. */
  const REGION_BOUNDS = {
    'Baden-Württemberg': [[47.537, 7.512], [49.788, 10.505]],
    'Bayern': [[47.270, 8.995], [50.565, 13.836]],
    'Berlin': [[52.339, 13.094], [52.675, 13.768]],
    'Brandenburg': [[51.362, 11.273], [53.556, 14.747]],
    'Bremen': [[53.015, 8.487], [53.230, 8.993]],
    'Hamburg': [[53.405, 9.724], [53.748, 10.337]],
    'Hessen': [[49.404, 7.785], [51.657, 10.237]],
    'Mecklenburg-Vorpommern': [[53.108, 10.597], [54.685, 14.416]],
    'Niedersachsen': [[51.301, 6.631], [53.931, 11.602]],
    'Nordrhein-Westfalen': [[50.322, 5.872], [52.533, 9.466]],
    'Rheinland-Pfalz': [[48.969, 6.098], [50.943, 8.509]],
    'Saarland': [[49.113, 6.355], [49.643, 7.412]],
    'Sachsen': [[50.180, 11.879], [51.681, 15.038]],
    'Sachsen-Anhalt': [[50.945, 10.563], [53.039, 13.199]],
    'Schleswig-Holstein': [[53.370, 7.863], [55.057, 11.314]],
    'Thüringen': [[50.200, 9.873], [51.645, 12.666]],
  };

  let map;
  let clusterGroup;
  let legendDiv;
  // légende repliée par défaut sur petit écran (elle couvrirait la carte)
  let legendCollapsed = window.matchMedia('(max-width: 860px)').matches;
  const markers = new Map(); // id -> marker
  const dataById = new Map(); // id -> site (pour le lien rayon des popups)
  let radiusCircle = null;

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
    const baseMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Fond de carte &copy; <a href="https://www.esri.com/">Esri</a> · Données &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxNativeZoom: 16,
      maxZoom: 19,
    }).addTo(map);
    // Vue satellite (demande équipe 09/09) — pour vérifier une installation
    // sur imagerie avant d'aller sur site.
    const baseSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
      maxNativeZoom: 18,
      maxZoom: 19,
    });
    L.control.layers({ 'Map': baseMap, 'Satellite': baseSat }, null,
      { position: 'topleft', collapsed: false }).addTo(map);

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

    // Lien « 50 km around » des popups -> filtre rayon
    map.on('popupopen', (e) => {
      const el = e.popup.getElement();
      const a = el.querySelector('a[data-radius-id]');
      if (a) a.addEventListener('click', (ev) => {
        ev.preventDefault();
        const d = dataById.get(a.dataset.radiusId);
        if (d) Filters.setRadius(d.lat, d.lon, 50, d.nom);
        map.closePopup();
      });
      const q = el.querySelector('a[data-qualify-id]');
      if (q) q.addEventListener('click', (ev) => {
        ev.preventDefault();
        const d = dataById.get(q.dataset.qualifyId);
        if (d) Qualify.open(d);
        map.closePopup();
      });
    });

    // vue d'entrée : la France entière, quelle que soit la taille de l'écran
    fitFrance();
  }

  function fitFrance() {
    if (map) map.fitBounds(FRANCE_BOUNDS, { padding: [10, 10] });
  }

  /* Cercle du filtre rayon : dessiné/retiré par Filters via show/hideRadius */
  /* Double trait (halo blanc + pointilles teal) : lisible sur fond clair
     comme sur imagerie satellite. */
  function showRadius(lat, lon, km) {
    hideRadius();
    const casing = L.circle([lat, lon], {
      radius: km * 1000, color: '#FFFFFF', weight: 5, opacity: 0.85,
      fill: false, interactive: false,
    });
    const dash = L.circle([lat, lon], {
      radius: km * 1000, color: PALETTE.teal, weight: 2.25,
      dashArray: '8 8', fillColor: PALETTE.teal, fillOpacity: 0.05,
      interactive: false,
    });
    radiusCircle = L.layerGroup([casing, dash]).addTo(map);
    map.fitBounds(dash.getBounds(), { padding: [20, 20] });
  }
  function hideRadius() {
    if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }
  }

  // Recentre sur un Land (nom MaStR) ; '' ou inconnu -> Allemagne entière
  function fitRegion(name) {
    if (!map) return;
    const b = REGION_BOUNDS[name];
    if (b) map.fitBounds(L.latLngBounds(b), { padding: [16, 16] });
    else fitFrance();
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
    // sites du registre pipeline ACR : halo ambre pour les repérer d'un coup d'œil
    const ring = d.inPipeline
      ? `border:2.5px solid ${PALETTE.amber};box-shadow:0 0 0 2px rgba(251,174,64,0.35);`
      : `border:1.5px solid #fff;box-shadow:0 1px 3px rgba(30,66,96,0.4);`;
    return L.divIcon({
      className: 'site-marker',
      html: `<div style="width:${size}px;height:${size}px;background:${color};${shape}
        ${ring}
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
    if (d.inPipeline)
      rows.push(['ACR pipeline', [d.pipeline.project, d.pipeline.status, d.pipeline.confidence]
        .filter(Boolean).join(' \u00b7 ')]);
    if (d.evalStatus && d.evalStatus !== 'unknown')
      rows.push(['Relationship', CONFIG.EVAL_LABELS[d.evalStatus] || d.evalStatus]);
    if (d.gridRating)
      rows.push(['Grid difficulty', CONFIG.GRID_LABELS[d.gridRating] || d.gridRating]);
    if (d.pipeline && d.pipeline.tags && d.pipeline.tags.length)
      rows.push(['Team knowledge', d.pipeline.tags.map(t => CONFIG.TAG_LABELS[t] || t).join(' \u00b7 ')]);
    if (d.pipeline && d.pipeline.waste)
      rows.push(['Permitted waste', d.pipeline.waste]);

    const hypNote = d.echeanceHyp
      ? `<div class="legend-note">Assumption: ${escapeHtml(d.echeanceHyp)}</div>` : '';
    const geoNote = d.geoPrecision === 'commune'
      ? `<div class="legend-note">Position at municipality centre</div>` : '';
    const plNote = d.pipeline && d.pipeline.note
      ? `<div class="legend-note">${escapeHtml(d.pipeline.note)}</div>` : '';
    const gmaps = (d.lat != null && d.lon != null)
      ? `<a class="popup-link" href="https://www.google.com/maps?q=${d.lat},${d.lon}"
           target="_blank" rel="noopener noreferrer">Google Maps ↗</a>` : '';
    const radiusLink = (d.lat != null && d.lon != null)
      ? `<a class="popup-link" href="#" data-radius-id="${escapeHtml(d.id)}"
           title="Filter to plants around this site">⌖ 50 km around</a>` : '';
    const qualifyLink = `<a class="popup-link" href="#" data-qualify-id="${escapeHtml(d.id)}"
           title="Open the qualification panel and file this site in the team register">✎ Qualify</a>`;

    return `
      <div class="popup-title">${escapeHtml(d.nom)}</div>
      <div class="popup-sub">${escapeHtml([d.commune, d.departement].filter(Boolean).join(' · '))}</div>
      <dl class="popup-grid">
        ${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v || '—'))}</dd>`).join('')}
      </dl>
      <div class="popup-foot">
        <span class="status-tag ${d.ouvert ? 'open' : 'closed'}">${d.ouvert ? 'Operating' : 'Closed'}</span>
        ${qualifyLink}
        ${radiusLink}
        ${gmaps}
      </div>
      ${hypNote}${geoNote}${plNote}`;
  }

  function update(data) {
    clusterGroup.clearLayers();
    markers.clear();

    dataById.clear();
    const layer = [];
    data.forEach(d => {
      dataById.set(d.id, d);
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
  return { init, update, focusOn, invalidateSize, fitFrance, fitRegion, showRadius, hideRadius, popupHtml };
})();
