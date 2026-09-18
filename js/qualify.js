/* ============================================
   Qualify — panneau latéral de qualification
   d'un site : identité (données MaStR, lecture
   seule) + formulaire Airtable pré-rempli.
   Aucune écriture directe : la fiche est créée
   par le formulaire partagé d'Airtable, puis
   ramenée dans l'app par la sync du registre.
   ============================================ */

const Qualify = (() => {
  const { fmtNum, fmtDate, escapeHtml, EVAL_LABELS, GRID_LABELS, CAP_UNITS,
          REGISTER_FORM_URL } = CONFIG;

  let drawer, frame, current = null;

  function init() {
    drawer = document.getElementById('qualify-drawer');
    frame = document.getElementById('qualify-frame');
    document.getElementById('qualify-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !drawer.hidden) close();
    });
  }

  // Le formulaire Airtable s'embarque via /embed/<lien partagé>
  function embedUrl(d) {
    const site = d.id.replace(/^(chp|inj)-/, '');
    const base = REGISTER_FORM_URL.includes('/embed/')
      ? REGISTER_FORM_URL
      : REGISTER_FORM_URL.replace('airtable.com/', 'airtable.com/embed/');
    const p = new URLSearchParams();
    p.set('prefill_MaStR-Nr', site);
    p.set('hide_MaStR-Nr', 'true');           // clé pré-remplie, cachée
    p.set('prefill_Plant name', d.nom || '');
    if (d.pipeline && d.pipeline.project) p.set('prefill_Project', d.pipeline.project);
    return `${base}?${p.toString()}`;
  }

  function identityHtml(d) {
    const site = d.id.replace(/^(chp|inj)-/, '');
    const unit = CAP_UNITS[d.base] || 'MW';
    const rows = [
      ['MaStR-Nr', site],
      ['Location', [d.commune, d.departement, d.region].filter(Boolean).join(' · ')],
      ['Type', d.type],
      ['Capacity', `${fmtNum(d.capacite, 2)} ${unit}`],
      ['Commissioned', fmtDate(d.dateMes)],
    ];
    if (d.echeanceAnnee != null) rows.push(['EEG support end (est.)', String(d.echeanceAnnee)]);
    if (d.base === 'cogen') {
      const flags = [d.flex ? 'Flexiprämie' : null, d.zuschlag ? 'Tender award (+10 y)' : null]
        .filter(Boolean).join(' · ');
      if (flags) rows.push(['Support flags', flags]);
    }
    if (d.evalStatus && d.evalStatus !== 'unknown')
      rows.push(['Current status', EVAL_LABELS[d.evalStatus] || d.evalStatus]);
    if (d.gridRating)
      rows.push(['Grid difficulty', GRID_LABELS[d.gridRating] || d.gridRating]);
    return `
      <div class="qualify-name">${escapeHtml(d.nom)}</div>
      <dl class="popup-grid">
        ${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v || '—'))}</dd>`).join('')}
      </dl>`;
  }

  function open(d) {
    current = d;
    document.getElementById('qualify-site').innerHTML = identityHtml(d);
    const note = document.getElementById('qualify-noform');
    if (REGISTER_FORM_URL) {
      note.hidden = true;
      frame.hidden = false;
      frame.src = embedUrl(d);
    } else {
      note.hidden = false;
      frame.hidden = true;
      frame.removeAttribute('src');
    }
    drawer.hidden = false;
    document.body.classList.add('qualify-open');
    setTimeout(() => { MapView.invalidateSize(); Charts.resize(); }, 220);
  }

  function close() {
    drawer.hidden = true;
    document.body.classList.remove('qualify-open');
    frame.removeAttribute('src'); // stoppe l'iframe
    current = null;
    setTimeout(() => { MapView.invalidateSize(); Charts.resize(); }, 220);
  }

  return { init, open, close };
})();
