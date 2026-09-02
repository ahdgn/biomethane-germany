/* ============================================
   Config — source unique de vérité (Allemagne)
   Données : Marktstammdatenregister (BNetzA), extrait 02/09/2026
   ============================================ */

const CONFIG = (() => {

  // Palette Nautilus (Masterbook)
  const PALETTE = {
    teal: '#22788C',
    navy: '#1E4260',
    deepNavy: '#002D5F',
    steel: '#3E6B96',
    lightBlue: '#9BB4D2',
    gold: '#CDAC81',
    sage: '#6F8F6D',
    terracotta: '#D9844A',
    amber: '#FBAE40',
    violet: '#503C64',
    ink: '#1A1A1A',
    grey: '#7F7F7F',
    hairline: '#D5DCE4',
  };

  // Couleur par type — BHKW par combustible, injection par technologie.
  const TYPE_COLORS = {
    'Biogas': PALETTE.teal,
    'Biomethan (Bioerdgas)': PALETTE.steel,
    'Klärgas': PALETTE.violet,
    'Deponiegas': PALETTE.gold,
    'Biomethan-Erzeugung': PALETTE.sage,
    'Power-to-Gas (Wasserstoff)': PALETTE.amber,
    'Power-to-Gas (Methan)': PALETTE.terracotta,
    'Förderung fossilen Erdgases': PALETTE.grey,
    'Liquefied Natural Gas': PALETTE.grey,
    'Sonstige': PALETTE.grey,
  };
  const TYPE_FALLBACK = PALETTE.grey;

  // Explication courte de chaque type (tooltips légende + filtres)
  const TYPE_DESCRIPTIONS = {
    'Biogas': 'CHP engine burning raw biogas from on-site anaerobic digestion — the conversion target',
    'Biomethan (Bioerdgas)': 'CHP engine running on upgraded biomethane drawn from the gas grid',
    'Klärgas': 'CHP running on sewage gas at a wastewater treatment plant',
    'Deponiegas': 'CHP running on landfill gas',
    'Biomethan-Erzeugung': 'Upgrading plant producing biomethane and injecting it into the gas grid',
    'Power-to-Gas (Wasserstoff)': 'Hydrogen production by electrolysis',
    'Power-to-Gas (Methan)': 'Synthetic methane from electrolysis plus methanation',
    'Sonstige': 'Technology not specified in the register',
  };

  /* Jeux de données. Les ids 'injection' et 'cogen' sont structurels
     (utilisés par app/map/charts/filters) : injection = unités de
     production de gaz (Einspeisung), cogen = BHKW biogaz (cibles). */
  const DATASETS = [
    {
      id: 'injection',
      label: 'Injection',
      labelLong: 'Gas production units (injection)',
      url: 'data/einspeisung.json',
      marker: 'circle',
      normalize: (d, i) => ({
        id: 'inj-' + (d.id != null ? d.id : i),
        base: 'injection',
        nom: d.nom || 'Unnamed',
        commune: d.gem || d.ort || '',
        departement: d.lk || '',
        region: d.bl || '',
        type: d.tech || 'Sonstige',
        capacite: d.kw ? d.kw / 1000 : 0, // MW
        annee: d.annee || null,
        dateMes: d.dateMes || null,
        operateur: '',
        opId: d.op || '',
        reseau: d.tech || '',
        ouvert: d.statut === 'In Betrieb',
        lat: d.lat,
        lon: d.lon,
        geoPrecision: d.lat != null ? 'site' : 'commune',
      }),
    },
    {
      id: 'cogen',
      label: 'CHP',
      labelLong: 'Biogas CHP (conversion targets)',
      url: 'data/chp-anlagen.json',
      marker: 'diamond',
      normalize: (d, i) => ({
        id: 'chp-' + (d.id != null ? d.id : i),
        base: 'cogen',
        nom: d.nom || 'Unnamed',
        commune: d.gem || d.ort || '',
        departement: d.lk || '',
        region: d.bl || '',
        type: d.fuel || 'Sonstige',
        filiere: d.fuel || '',
        capacite: d.kw ? d.kw / 1000 : 0, // MW électriques
        annee: d.annee || null,
        dateMes: d.dateMes || null,
        operateur: d.lk || '',
        opId: d.op || '',
        reseau: d.tech || '',
        ouvert: true, // le jeu ne contient que les unités « In Betrieb »
        lat: d.lat,
        lon: d.lon,
        geoPrecision: d.lat != null ? 'site' : 'commune',
        puissanceKw: d.kw || null,
        combustible: '',
        nUnites: d.n || 1,
        flex: !!d.flex,       // Flexiprämie revendiquée
        zuschlag: !!d.zus,    // Anschlussförderung déjà obtenue (appel d'offres)
      }),
    },
  ];

  // Unités de capacité par base
  const CAP_UNITS = { injection: 'MW', cogen: 'MW el' };

  /* ---- Plancher de l'axe temps ----
     Premières unités biogaz dans les années 1990 ; tout ce qui précède
     2000 est agrégé sous « < 2000 ». */
  const YEAR_FLOOR = 2000;
  const YEAR_FLOOR_LABEL = '< ' + YEAR_FLOOR;

  const SOURCE_NOTE = 'Marktstammdatenregister (BNetzA), extract of 02/09/2026 — via open-mastr';

  // ---- Formats (UI française, données allemandes) ----
  const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-GB'));
  const fmtNum = (n, dec = 1) =>
    n == null ? '—' : n.toLocaleString('en-GB', { maximumFractionDigits: dec });
  const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const t = Date.parse(iso.length === 10 ? iso + 'T00:00:00' : iso);
    return Number.isNaN(t) ? iso : dateFmt.format(new Date(t));
  };
  const escapeHtml = (text) => String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const typeColor = (type) => TYPE_COLORS[type] || TYPE_FALLBACK;

  /* ---- Échéance de soutien ----
     BHKW : la rémunération EEG court 20 années civiles à partir de la MES
     (règle dure, §25 EEG). L'Anschlussförderung (appel d'offres Biomasse)
     ajoute 10 ans pour les lauréats — signalée via le flag zuschlag.
     Injection : pas de tarif d'achat en Allemagne (THG-Quote / RED III,
     contrats bilatéraux) → pas d'échéance. */
  function echeance(d) {
    if (d.base !== 'cogen' || !d.annee) return { annee: null, hyp: null };
    if (d.zuschlag) {
      return { annee: d.annee + 20, hyp: 'EEG — 20 years; follow-up support already secured (+10 years, tender award)' };
    }
    return { annee: d.annee + 20, hyp: 'EEG — 20 years from commissioning (Sec. 25 EEG)' };
  }

  /* ---- Filtre prospection 1 (Allemagne) ----
     PLACEHOLDER en attente de l'atelier de screening — paramètres
     par défaut de tools/screening_params.example.json :
     · BHKW au biogaz, 75 kW – 1,5 MW él ;
     · fin de l'EEG entre 2026 et 2032 ;
     · exclusion des lauréats d'appel d'offres (déjà sécurisés). */
  function prospection1(d) {
    if (d.base !== 'cogen') return false;
    if (d.type !== 'Biogas' || !d.ouvert || !d.annee) return false;
    const fin = d.annee + 20;
    return d.capacite >= 0.075 && d.capacite <= 1.5
      && fin >= 2026 && fin <= 2032 && !d.zuschlag;
  }

  return { PALETTE, TYPE_COLORS, TYPE_FALLBACK, TYPE_DESCRIPTIONS, DATASETS, CAP_UNITS, SOURCE_NOTE,
           YEAR_FLOOR, YEAR_FLOOR_LABEL,
           fmtInt, fmtNum, fmtDate, escapeHtml, typeColor, echeance, prospection1 };
})();
