const DEFAULTS = {
  color: '#00FFFF',
  fontSize: 26,
  fontFamily: '"Segoe UI",Arial,sans-serif',
  fontWeight: '700',
  bgColor: '#000000',
  bgOpacity: 0,
  bgPadding: 0,
  shadow: true,
  bottom: 12,
  width: 88,
  showOriginal: true,
};

const ids = ['color','fontSize','fontFamily','fontWeight','bgColor','bgOpacity','bgPadding','shadow','bottom','width','showOriginal'];

function getValues() {
  return {
    color:      document.getElementById('color').value,
    fontSize:   +document.getElementById('fontSize').value,
    fontFamily: document.getElementById('fontFamily').value,
    fontWeight: document.getElementById('fontWeight').value,
    bgColor:    document.getElementById('bgColor').value,
    bgOpacity:  +document.getElementById('bgOpacity').value,
    bgPadding:  +document.getElementById('bgPadding').value,
    shadow:     document.getElementById('shadow').checked,
    bottom:     +document.getElementById('bottom').value,
    width:      +document.getElementById('width').value,
    showOriginal: document.getElementById('showOriginal').checked,
  };
}

function applyToInputs(s) {
  document.getElementById('color').value      = s.color;
  document.getElementById('fontSize').value   = s.fontSize;
  document.getElementById('fontFamily').value = s.fontFamily;
  document.getElementById('fontWeight').value = s.fontWeight;
  document.getElementById('bgColor').value    = s.bgColor;
  document.getElementById('bgOpacity').value  = s.bgOpacity;
  document.getElementById('bgPadding').value  = s.bgPadding;
  document.getElementById('shadow').checked   = s.shadow;
  document.getElementById('bottom').value     = s.bottom;
  document.getElementById('width').value      = s.width;
  document.getElementById('showOriginal').checked = s.showOriginal;
  updateBadges();
  updatePreview();
}

function updateBadges() {
  document.getElementById('fontSize-val').textContent  = document.getElementById('fontSize').value + 'px';
  document.getElementById('bgOpacity-val').textContent = document.getElementById('bgOpacity').value + '%';
  document.getElementById('bgPadding-val').textContent = document.getElementById('bgPadding').value + 'px';
  document.getElementById('bottom-val').textContent    = document.getElementById('bottom').value + '%';
  document.getElementById('width-val').textContent     = document.getElementById('width').value + '%';
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

function updatePreview() {
  const s = getValues();
  const el = document.getElementById('preview-text');
  const wrap = document.getElementById('preview-wrap');

  // Position: bottom % relative to the 120px preview box
  const bottomPx = (s.bottom / 100) * 120;
  el.style.bottom    = bottomPx + 'px';
  el.style.top       = 'auto';
  el.style.color     = s.color;
  el.style.fontSize  = Math.min(s.fontSize, 22) + 'px'; // cap for preview
  el.style.fontFamily = s.fontFamily;
  el.style.fontWeight = s.fontWeight;
  el.style.width     = s.width + '%';
  el.style.padding   = s.bgPadding + 'px ' + (s.bgPadding + 4) + 'px';
  el.style.borderRadius = s.bgPadding > 0 ? '4px' : '0';

  const opacity = s.bgOpacity / 100;
  el.style.background = opacity > 0
    ? `rgba(${hexToRgb(s.bgColor)},${opacity})`
    : 'transparent';

  el.style.textShadow = s.shadow
    ? '-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000'
    : 'none';
}

// Live update on any input change
ids.forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', () => { updateBadges(); updatePreview(); });
  el.addEventListener('change', () => { updateBadges(); updatePreview(); });
});

document.getElementById('btn-save').addEventListener('click', () => {
  const s = getValues();
  chrome.storage.sync.set({ subtitleSettings: s }, () => {
    const status = document.getElementById('status');
    status.textContent = '✓ Saved';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});

document.getElementById('btn-reset').addEventListener('click', () => {
  applyToInputs(DEFAULTS);
});

// Load saved settings on open
chrome.storage.sync.get('subtitleSettings', ({ subtitleSettings }) => {
  applyToInputs({ ...DEFAULTS, ...subtitleSettings });
});

