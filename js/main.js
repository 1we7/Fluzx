(function () {
  'use strict';

  var cs = new CSInterface();

  // ── TABS ──────────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // ── TOAST ─────────────────────────────────────────────────
  var toastTimer;
  function toast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.style.display = 'block';
    el.style.background   = isError ? '#3a1a1a' : '#1e2a1e';
    el.style.borderTopColor = isError ? '#cc3333' : '#555';
    el.style.color        = isError ? '#ff6666' : '#e8e8e8';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { el.style.display = 'none'; }, 3000);
  }

  // ─────────────────────────────────────────────────────────
  // FLOW-STYLE BÉZIER GRAPH
  // ─────────────────────────────────────────────────────────

  var BEZIER_PRESETS = {
    easeInOut:  [0.42, 0,    0.58, 1   ],
    easeIn:     [0.42, 0,    1,    1   ],
    easeOut:    [0,    0,    0.58, 1   ],
    linear:     [0,    0,    1,    1   ],
    overshoot:  [0.34, 1.56, 0.64, 1   ],
    bounce:     [0.68, -0.6, 0.32, 1.6 ]
  };

  // Built-in presets (always visible, cannot be deleted)
  var BUILTIN_PRESETS = [
    { name: 'Ease In Out',  type: 'easeInOut', influence: 66, coords: [0.42, 0, 0.58, 1],       builtin: true },
    { name: 'Overshoot',    type: 'overshoot', influence: 80, coords: [0.34, 1.56, 0.64, 1],    builtin: true },
    { name: 'Bounce',       type: 'bounce',    influence: 90, coords: [0.68, -0.6, 0.32, 1.6],  builtin: true },
    { name: 'Linear',       type: 'linear',    influence: 0,  coords: [0, 0, 1, 1],              builtin: true }
  ];

  // User-saved presets: loaded from disk, custom only (no builtins stored here)
  var userCustomPresets = [];

  var activePresetIdx = 0; // currently selected preset index

  // ── PERSISTANCE PRESETS (Documents/Fluzx/presets.json via ExtendScript) ──────
  // On passe par cs.evalScript + File JSX pour eviter les bugs d'encodage
  // de window.cep.fs (UTF-16, erreurs silencieuses, etc.)

  // Returns builtins + custom presets combined
  function getAllPresets() {
    return BUILTIN_PRESETS.concat(userCustomPresets);
  }

  // Charge les presets depuis le disque (async via JSX)
  // callback(ok: boolean) appele quand c'est fini
  function loadPresetsFromDisk(callback) {
    cs.evalScript('fluzxReadPresets()', function(result) {
      if (result && result.indexOf('ERROR:') !== 0) {
        try {
          var parsed = JSON.parse(result);
          if (Array.isArray(parsed)) {
            userCustomPresets = parsed.filter(function(p) { return !p.builtin; });
          }
        } catch(e) {
          console.warn('Fluzx: presets.json corrompu, reset.', e);
          userCustomPresets = [];
        }
      }
      if (callback) callback(true);
    });
  }

  // Sauvegarde les presets custom sur le disque (async via JSX)
  function savePresetsToDisk() {
    var json = JSON.stringify(userCustomPresets, null, 2);
    // On escape les guillemets et sauts de ligne pour passer la string a evalScript
    var safe = json.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    cs.evalScript('fluzxWritePresets("' + safe + '")', function(res) {
      if (res && res.indexOf('ERROR:') === 0) {
        console.error('Fluzx: sauvegarde echouee:', res);
      }
    });
  }

  var bezier = { coords: [0.42, 0, 0.58, 1] };
  var lastCoords  = [0.42, 0, 0.58, 1];

  var wrapper     = document.getElementById('graph-wrapper');
  var canvasGhost = document.getElementById('canvas-ghost');
  var canvasCurve = document.getElementById('canvas-curve');
  var ctxG        = canvasGhost.getContext('2d');
  var ctxC        = canvasCurve.getContext('2d');
  var cp1El       = document.getElementById('cp1');
  var cp2El       = document.getElementById('cp2');

  var PAD = 0.12;

  function resizeGraph() {
    var rect = wrapper.getBoundingClientRect();
    var sz   = Math.floor(rect.width);
    canvasGhost.width  = sz;
    canvasGhost.height = sz;
    canvasCurve.width  = sz;
    canvasCurve.height = sz;
    positionHandles();
    redraw();
  }

  function toCanvas(nx, ny) {
    var sz = canvasCurve.width;
    var inner = sz * (1 - 2 * PAD);
    return {
      x: sz * PAD + nx * inner,
      y: sz * PAD + (1 - ny) * inner
    };
  }

  function toNorm(px, py) {
    var sz = canvasCurve.width;
    var inner = sz * (1 - 2 * PAD);
    return {
      x: (px - sz * PAD) / inner,
      y: 1 - (py - sz * PAD) / inner
    };
  }

  function positionHandles() {
    var c  = bezier.coords;
    var sz = canvasCurve.width;
    var p1 = toCanvas(c[0], c[1]);
    var p2 = toCanvas(c[2], c[3]);
    cp1El.style.left = p1.x + 'px';
    cp1El.style.top  = p1.y + 'px';
    cp2El.style.left = p2.x + 'px';
    cp2El.style.top  = p2.y + 'px';
    // Masquer les poignees qui sortent des limites du canvas (ex: overshoot, bounce)
    var margin = 5; // px de tolerance
    cp1El.style.visibility = (p1.x >= -margin && p1.x <= sz + margin && p1.y >= -margin && p1.y <= sz + margin) ? 'visible' : 'hidden';
    cp2El.style.visibility = (p2.x >= -margin && p2.x <= sz + margin && p2.y >= -margin && p2.y <= sz + margin) ? 'visible' : 'hidden';
  }

  function updateBezierDisplay() {
    var c = bezier.coords;
    document.getElementById('bv-p1x').value = c[0].toFixed(2);
    document.getElementById('bv-p1y').value = c[1].toFixed(2);
    document.getElementById('bv-p2x').value = c[2].toFixed(2);
    document.getElementById('bv-p2y').value = c[3].toFixed(2);
  }

  // Allow typing values directly into the bezier coordinate inputs
  function bindBezierInput(id, coordIdx) {
    var el = document.getElementById(id);
    el.addEventListener('focus', function() { this.select(); });
    el.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        this.blur();
      }
    });
    el.addEventListener('blur', function() {
      var v = parseFloat(this.value);
      if (isNaN(v)) { updateBezierDisplay(); return; }
      // x coords (0,2) clamped to [0,1]; y coords (1,3) are free (allow overshoot)
      if (coordIdx === 0 || coordIdx === 2) v = Math.min(1, Math.max(0, v));
      v = +v.toFixed(3);
      lastCoords = bezier.coords.slice();
      bezier.coords[coordIdx] = v;
      redraw();
    });
  }

  function drawBezierOnCtx(ctx, sz, coords, style) {
    var p0 = toCanvas(0, 0);
    var p1 = toCanvas(coords[0], coords[1]);
    var p2 = toCanvas(coords[2], coords[3]);
    var p3 = toCanvas(1, 1);

    if (style.showGrid) {
      ctx.strokeStyle = '#1e1e1e';
      ctx.lineWidth   = 1;
      var steps = 4;
      for (var xi = 0; xi <= steps; xi++) {
        var gx = sz * PAD + (xi / steps) * sz * (1 - 2 * PAD);
        ctx.beginPath(); ctx.moveTo(gx, sz * PAD); ctx.lineTo(gx, sz * (1 - PAD)); ctx.stroke();
      }
      for (var yi = 0; yi <= steps; yi++) {
        var gy = sz * PAD + (yi / steps) * sz * (1 - 2 * PAD);
        ctx.beginPath(); ctx.moveTo(sz * PAD, gy); ctx.lineTo(sz * (1 - PAD), gy); ctx.stroke();
      }
      ctx.strokeStyle = '#282828';
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p3.x, p3.y); ctx.stroke();
      ctx.setLineDash([]);
    }

    if (style.showHandles) {
      ctx.strokeStyle = style.handleColor;
      ctx.lineWidth   = style.handleWidth * sz;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
      ctx.moveTo(p3.x, p3.y); ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      var r = style.handleWidth * sz * 2;
      ctx.fillStyle = style.handleColor;
      ctx.beginPath(); ctx.arc(p1.x, p1.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(p2.x, p2.y, r, 0, Math.PI * 2); ctx.fill();
    }

    if (style.showAnchors) {
      ctx.fillStyle = '#555';
      var ar = 2.5;
      ctx.beginPath(); ctx.arc(p0.x, p0.y, ar, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(p3.x, p3.y, ar, 0, Math.PI * 2); ctx.fill();
    }

    ctx.strokeStyle = style.curveColor;
    ctx.lineWidth   = style.curveWidth * sz;
    ctx.shadowColor = style.shadow || 'transparent';
    ctx.shadowBlur  = style.shadowBlur || 0;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function redraw() {
    var sz = canvasCurve.width;

    ctxG.clearRect(0, 0, sz, sz);
    drawBezierOnCtx(ctxG, sz, lastCoords, {
      curveColor:  '#383838',
      curveWidth:  0.012,
      handleColor: '#000',
      handleWidth: 0,
      showHandles: false,
      showAnchors: false,
      showGrid:    true
    });

    ctxC.clearRect(0, 0, sz, sz);
    drawBezierOnCtx(ctxC, sz, bezier.coords, {
      curveColor:  '#f0f0f0',
      curveWidth:  0.014,
      handleColor: '#fdbf28',
      handleWidth: 0.009,
      showHandles: true,
      showAnchors: true,
      showGrid:    false,
      shadow:      'rgba(240,240,240,0.2)',
      shadowBlur:  5
    });

    positionHandles();
    updateBezierDisplay();
  }

  // ── Drag handles ─────────────────────────────────────────
  function makeDraggable(el, coordIdx) {
    var dragging = false;
    var startX, startY, startNX, startNY;

    el.addEventListener('mousedown', function(e) {
      e.preventDefault();
      dragging  = true;
      startX    = e.clientX;
      startY    = e.clientY;
      startNX   = bezier.coords[coordIdx];
      startNY   = bezier.coords[coordIdx + 1];
      document.body.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      var sz    = canvasCurve.width;
      var inner = sz * (1 - 2 * PAD);
      var rect  = wrapper.getBoundingClientRect();
      var scale = sz / rect.width;

      var dx = (e.clientX - startX) * scale;
      var dy = (e.clientY - startY) * scale;

      var rawNX = startNX + dx / inner;
      var rawNY = startNY - dy / inner;

      // Murs invisibles : on empêche X de coller exactement à 0 ou 1
      // (quand la poignée est collée au bord, l'apply bug car l'influence = 0 ou 100)
      var WALL = 0.02; // marge configurable — 0.02 = 2% du graphe
      var nx = Math.min(1 - WALL, Math.max(WALL,    rawNX));
      var ny = Math.min(1.35,     Math.max(-0.35, rawNY));

      // Fix sticky-clamp : recaler le point de depart quand on touche un mur
      if (rawNX !== nx) { startX = e.clientX; startNX = nx; }
      if (rawNY !== ny) { startY = e.clientY; startNY = ny; }

      bezier.coords[coordIdx]     = +nx.toFixed(3);
      bezier.coords[coordIdx + 1] = +ny.toFixed(3);

      redraw();
    });

    document.addEventListener('mouseup', function() {
      if (dragging) {
        dragging = false;
        document.body.style.cursor = '';
      }
    });
  }

  makeDraggable(cp1El, 0);
  makeDraggable(cp2El, 2);

  // Marquer le champ render-name comme édité manuellement
  document.getElementById('render-name').addEventListener('input', function() {
    this._userEdited = true;
  });

  bindBezierInput('bv-p1x', 0);
  bindBezierInput('bv-p1y', 1);
  bindBezierInput('bv-p2x', 2);
  bindBezierInput('bv-p2y', 3);

  // ── Curve type / influence ─────────────────────────────────
  document.getElementById('curve-type').addEventListener('change', function() {
    var type = this.value;
    var preset = BEZIER_PRESETS[type];
    if (!preset) return;
    lastCoords       = bezier.coords.slice();
    bezier.coords    = preset.slice();
    redraw();
  });

  document.getElementById('curve-influence').addEventListener('input', function() {
    document.getElementById('curve-influence-val').textContent = this.value + '%';
    var inf  = parseFloat(this.value) / 100;
    var type = document.getElementById('curve-type').value;
    var base = BEZIER_PRESETS[type] || BEZIER_PRESETS.easeInOut;
    lastCoords = bezier.coords.slice();
    bezier.coords = [
      +(base[0] * inf * 1.5).toFixed(3),
      base[1],
      +(1 - (1 - base[2]) * inf * 1.5).toFixed(3),
      base[3]
    ];
    bezier.coords[0] = Math.min(1, Math.max(0, bezier.coords[0]));
    bezier.coords[2] = Math.min(1, Math.max(0, bezier.coords[2]));
    redraw();
  });

  // ── APPLY BUTTON ──────────────────────────────────────────
  document.getElementById('apply-btn').addEventListener('click', function() {
    var type = document.getElementById('curve-type').value;
    var inf  = document.getElementById('curve-influence').value;
    var c    = bezier.coords; // [p1x, p1y, p2x, p2y]
    // Pass coords so JSX can derive correct AE influence from actual bezier shape
    cs.evalScript(
      'applyEasing("' + type + '",' + inf + ',' +
      c[0] + ',' + c[1] + ',' + c[2] + ',' + c[3] + ')',
      function(res) {
        if (res === 'ok') toast('Easing applied!');
        else toast(res || 'Error', true);
      }
    );
  });

  // ── MINI PRESET GRAPHS ────────────────────────────────────
  function drawMiniCurve(canvas, coords, isActive) {
    var ctx = canvas.getContext('2d');
    var sz  = canvas.width;
    var PAD2 = 0.15;
    var inner = sz * (1 - 2 * PAD2);

    ctx.clearRect(0, 0, sz, sz);

    // Background
    ctx.fillStyle = isActive ? '#2a2a2a' : '#1a1a1a';
    ctx.fillRect(0, 0, sz, sz);

    // Diagonal reference
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(sz * PAD2, sz * (1 - PAD2));
    ctx.lineTo(sz * (1 - PAD2), sz * PAD2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Bezier curve
    var x0 = sz * PAD2,            y0 = sz * (1 - PAD2);
    var x3 = sz * (1 - PAD2),      y3 = sz * PAD2;
    var x1 = x0 + coords[0] * inner, y1 = y0 - coords[1] * inner;
    var x2 = x0 + coords[2] * inner, y2 = y0 - coords[3] * inner;

    ctx.strokeStyle = isActive ? '#fdbf28' : '#888';
    ctx.lineWidth   = isActive ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
    ctx.stroke();

    // Anchor dots
    ctx.fillStyle = isActive ? '#fdbf28' : '#555';
    ctx.beginPath(); ctx.arc(x0, y0, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x3, y3, 1.5, 0, Math.PI * 2); ctx.fill();
  }

  function renderPresetGraphs() {
    var container = document.getElementById('preset-graphs');
    container.innerHTML = '';

    var allPresets = getAllPresets();

    for (var i = 0; i < allPresets.length; i++) {
      (function(idx) {
        var preset = allPresets[idx];
        var wrap = document.createElement('div');
        wrap.className = 'preset-mini' + (idx === activePresetIdx ? ' active' : '');
        wrap.title = preset.name + (preset.builtin ? ' (built-in)' : '');

        var canvas = document.createElement('canvas');
        canvas.width  = 44;
        canvas.height = 44;
        drawMiniCurve(canvas, preset.coords, idx === activePresetIdx);

        var label = document.createElement('div');
        label.className = 'preset-mini-label';
        label.textContent = preset.name;

        wrap.appendChild(canvas);
        wrap.appendChild(label);

        wrap.addEventListener('click', function() {
          activePresetIdx = idx;
          // Load preset into main graph
          lastCoords    = bezier.coords.slice();
          bezier.coords = preset.coords.slice();
          document.getElementById('curve-type').value = preset.type;
          document.getElementById('curve-influence').value = preset.influence;
          document.getElementById('curve-influence-val').textContent = preset.influence + '%';
          redraw();
          renderPresetGraphs();
        });

        container.appendChild(wrap);
      })(i);
    }
  }

  // ── SAVE PRESET ──────────────────────────────────────────
  document.getElementById('save-preset').addEventListener('click', function() {
    var name = prompt('Preset name:');
    if (!name || !name.trim()) return;
    var type = document.getElementById('curve-type').value;
    var inf  = parseInt(document.getElementById('curve-influence').value, 10);
    userCustomPresets.push({ name: name.trim(), type: type, influence: inf, coords: bezier.coords.slice() });
    activePresetIdx = getAllPresets().length - 1;
    savePresetsToDisk();
    renderPresetGraphs();
    toast('Preset "' + name.trim() + '" saved');
  });

  // ── DELETE PRESET ─────────────────────────────────────────
  document.getElementById('delete-preset').addEventListener('click', function() {
    var allPresets = getAllPresets();
    if (allPresets.length === 0) { toast('No presets to delete', true); return; }
    var p = allPresets[activePresetIdx];
    if (p.builtin) { toast('Cannot delete built-in presets', true); return; }
    if (!confirm('Delete "' + p.name + '"?')) return;
    // Find index in userCustomPresets (offset by BUILTIN_PRESETS.length)
    var customIdx = activePresetIdx - BUILTIN_PRESETS.length;
    userCustomPresets.splice(customIdx, 1);
    if (activePresetIdx >= getAllPresets().length) activePresetIdx = getAllPresets().length - 1;
    if (activePresetIdx < 0) activePresetIdx = 0;
    savePresetsToDisk();
    renderPresetGraphs();
    toast('Preset deleted');
  });

  // ── UTILITIES ─────────────────────────────────────────────
  document.querySelectorAll('.util-btn[data-fn]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var fn = btn.dataset.fn;
      cs.evalScript('utilFn("' + fn + '")', function(res) {
        if (res === 'ok') toast('Done!');
        else toast(res || 'Error', true);
      });
    });
  });

  setInterval(function() {
    cs.evalScript('getSelectedLayerName()', function(res) {
      var el = document.getElementById('layer-name');
      if (res && res !== 'undefined' && res !== '') {
        el.textContent = res; el.style.color = 'var(--text)';
      } else {
        el.textContent = 'No layer selected'; el.style.color = 'var(--muted)';
      }
    });
    cs.evalScript('getActiveCompName()', function(res) {
      var el = document.getElementById('render-comp-name');
      var nameInput = document.getElementById('render-name');
      if (res && res !== 'undefined' && res !== '') {
        el.textContent = res; el.style.color = 'var(--text)';
        // Remplir le champ name seulement si vide ou si comp change
        if (!nameInput._userEdited || nameInput._lastComp !== res) {
          nameInput.value = res;
          nameInput._lastComp = res;
          nameInput._userEdited = false;
        }
      } else {
        el.textContent = '—'; el.style.color = 'var(--muted)';
      }
    });
  }, 1000);

  // ── RENDER ────────────────────────────────────────────────

  // (Mode selector supprimé de l'UI — listener désactivé)

  var outputPath = '';
  document.getElementById('browse-btn').addEventListener('click', function() {
    cs.evalScript('browseFolder()', function(res) {
      if (res && res !== 'null' && res !== 'undefined') {
        outputPath = res;
        document.getElementById('output-path').value = res;
      }
    });
  });

  // ── Render (AE ou AME selon engine sélectionné) ──
  document.getElementById('render-btn').addEventListener('click', function() {
    if (!outputPath) { toast('Choose an output folder', true); return; }
    var engine = document.getElementById('render-engine').value;
    var name   = document.getElementById('render-name').value.trim();
    if (engine === 'ame') {
      cs.evalScript(
        'sendToAME(\"' + outputPath + '\",\"' + name + '\")',
        function(res) {
          if (res === 'ok') toast('Sent to Media Encoder!');
          else toast(res || 'Error', true);
        }
      );
    } else {
      cs.evalScript(
        'startRender(\"' + outputPath + '\",\"' + name + '\")',
        function(res) {
          if (res === 'ok') toast('Added to Render Queue!');
          else toast(res || 'Error', true);
        }
      );
    }
  });

  // ── Clear Cache ──
  document.getElementById('cache-btn').addEventListener('click', function() {
    cs.evalScript('cleanCache()', function(res) {
      if (res === 'ok') toast('Cache cleared!');
      else toast(res || 'Error', true);
    });
  });

  // ── INIT ──────────────────────────────────────────────────
  window.addEventListener('load', function() {
    // resizeGraph d'abord (le canvas doit avoir une taille avant de dessiner)
    resizeGraph();
    // Charge les presets depuis Documents/Fluzx/presets.json via JSX
    // puis render — les builtins s'affichent meme si le load echoue
    loadPresetsFromDisk(function() {
      renderPresetGraphs();
    });
    // Affichage immediat des builtins pendant que le disk load est en cours
    renderPresetGraphs();
  });
  window.addEventListener('resize', function() {
    resizeGraph();
  });

}());
