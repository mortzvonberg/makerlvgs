const $ = s => document.querySelector(s), NS = 'http://www.w3.org/2000/svg';
const colors = { M: '#ff666b', T: '#619dff', L: '#27d69b', P: '#f279d6' };
const buildingName = (b, f = currentFloor) => ({ M: 'M-bygget', T: 'T-bygget', L: 'L-bygget', P: 'Miljøbygget' })[b];
const floorImages = { 1: 'plan.jpg', 2: 'plan2.jpg' }, overview = [-120, -130, 10240, 4560];
const buildingViews = { M: [-100, 650, 3000, 3600], T: [2850, 950, 4050, 2100], L: [6750, -100, 3300, 3100], P: [2670, 2400, 1000, 1900] };
let currentFloor = 1, filter = 'all', selected = null, view = [...overview], drag = null, placing = false, pendingPoint = null;

const USER_KEY = 'skolekart-user-data-v2', LEGACY_KEY = 'skolekart-room-names-v1';
const builtinIds = new Set(ROOMS.map(r => r.id));
let customNames = {}, customRooms = [];

const norm = s => s.toLocaleLowerCase('nb').replace(/\s+/g, '');
const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function validateRooms(value) {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Ugyldig romliste.');
  return value.map(r => {
    if (!r || typeof r.id !== 'string' || !/^USER-[12]-[a-z0-9-]+$/.test(r.id) || builtinIds.has(r.id) || ![1, 2].includes(r.floor) || !['M', 'T', 'L', 'P'].includes(r.building) || !Number.isFinite(r.x) || !Number.isFinite(r.y) || r.x < 0 || r.x > 10000 || r.y < 0 || r.y > 4300 || typeof r.name !== 'string' || !r.name.trim() || r.name.trim().length > 80) {
      throw new Error('Romfilen inneholder et ugyldig rom.');
    }
    return { id: r.id, floor: r.floor, building: r.building, x: r.x, y: r.y, name: r.name.trim(), custom: true, unnumbered: true };
  });
}

function validNames(value, extra = customRooms) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ugyldig navnefil.');
  const ids = new Set([...builtinIds, ...extra.map(r => r.id)]), result = {};
  for (const [id, name] of Object.entries(value)) {
    if (ids.has(id) && typeof name === 'string' && name.trim() && name.trim().length <= 80) {
      result[id] = name.trim();
    }
  }
  return result;
}

// Lokal fallback-lasting
try {
  const raw = localStorage.getItem(USER_KEY);
  if (raw) {
    const data = JSON.parse(raw);
    customRooms = validateRooms(data.rooms || []);
    customNames = validNames(data.names || {}, customRooms);
  } else {
    customNames = validNames(JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}'));
  }
} catch { /* behold standardrom */ }

ROOMS.push(...customRooms);

const roomName = r => customNames[r.id] || r.name;
const roomTitle = r => r.unnumbered ? roomName(r) : r.id;

// Lagre data både lokalt og til Firebase Firestore
async function saveData(names = customNames, rooms = customRooms) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify({ names, rooms }));
    customNames = names;
    customRooms = rooms;

    if (window.db) {
      await window.db.collection('skolekart').doc('felles').set({
        names: names,
        rooms: rooms,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      status('Lagret i skyen for alle!');
    } else {
      status('Lagret lokalt (Firebase er ikke satt opp).');
    }
    return true;
  } catch (err) {
    console.error('Feil ved lagring:', err);
    status('Kunne ikke lagre til skyen: ' + (err.message || 'Ukjent feil'));
    return false;
  }
}

// Sanntidssynkronisering med Firebase Firestore
function setupFirebaseSync() {
  if (!window.db) return;
  window.db.collection('skolekart').doc('felles').onSnapshot(doc => {
    if (!doc.exists) return;
    const data = doc.data() || {};
    try {
      const serverRooms = validateRooms(data.rooms || []);
      const serverNames = validNames(data.names || {}, serverRooms);

      // Oppdater globale arrays og objekter
      customNames = serverNames;
      customRooms = serverRooms;

      // Tilbakestill ROOMS til innebygde pluss nye fra server
      const builtinOnly = ROOMS.filter(r => !r.custom);
      ROOMS.length = 0;
      ROOMS.push(...builtinOnly, ...customRooms);

      // Oppdater i nettleserlagring også
      localStorage.setItem(USER_KEY, JSON.stringify({ names: customNames, rooms: customRooms }));

      rebuildMarkers();
      render();
      if (selected) {
        const current = ROOMS.find(r => r.id === selected);
        if (current) showDetails(current);
      }
    } catch (e) {
      console.warn('Kunne ikke synkronisere data fra Firebase:', e);
    }
  }, err => {
    console.error('Feil i sanntidslytter:', err);
  });
}

function status(message) {
  $('#transferstatus').textContent = message;
  const e = $('#editstatus');
  if (e) e.textContent = message;
}

function visible() {
  const q = norm($('#search').value);
  return ROOMS.filter(r => (q || r.floor === currentFloor) && (filter === 'all' || r.building === filter) && (!q || norm((r.unnumbered ? '' : r.id) + ' ' + roomName(r) + ' ' + r.name + ' ' + buildingName(r.building, r.floor)).includes(q) || (!r.unnumbered && r.id.slice(1) === q))).sort((a, b) => Number(norm(b.id) === q) - Number(norm(a.id) === q) || roomTitle(a).localeCompare(roomTitle(b), 'nb', { numeric: true }));
}

function render() {
  const searching = Boolean($('#search').value.trim());
  $('.listhead').hidden = !searching;
  $('#results').hidden = !searching;
  const rows = searching ? visible() : [];
  $('#count').textContent = rows.length + ' rom';
  $('#listtitle').textContent = $('#search').value ? 'Søkeresultater' : filter === 'all' ? `Rom i ${currentFloor}. etasje` : buildingName(filter);
  $('#results').replaceChildren();
  if (searching && !rows.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Ingen rom funnet. Prøv et annet navn, eller velg «Alle bygg». Du kan legge til rom som mangler.';
    $('#results').append(p);
  }
  for (const r of rows) {
    const b = document.createElement('button');
    b.className = 'result' + (r.id === selected ? ' selected' : '');
    b.innerHTML = `<span class="badge ${r.building}">${r.building === 'P' ? '◆' : r.building}</span><span><strong>${escapeHTML(roomTitle(r))}</strong><small>${r.unnumbered ? '' : escapeHTML(roomName(r)) + ' · '}${buildingName(r.building, r.floor)} · ${r.floor}. etasje</small></span><span class="arrow">↗</span>`;
    b.onclick = () => select(r);
    $('#results').append(b);
  }
  document.querySelectorAll('.marker').forEach(g => {
    const r = ROOMS.find(r => r.id === g.dataset.id);
    if (!r) return;
    g.style.display = r.floor === currentFloor && (filter === 'all' || filter === r.building) ? '' : 'none';
    g.classList.toggle('selected', r.id === selected);
  });
}

function updateLabels() {
  document.querySelectorAll('.marker').forEach(g => {
    const r = ROOMS.find(r => r.id === g.dataset.id);
    if (!r) return;
    const label = r.unnumbered ? roomName(r) : customNames[r.id] ? `${r.id} · ${roomName(r)}` : r.id;
    g.setAttribute('aria-label', `${roomTitle(r)}, ${buildingName(r.building, r.floor)}, ${r.floor}. etasje`);
    const titleEl = g.querySelector('title');
    if (titleEl) titleEl.textContent = label;
    const textEl = g.querySelector('text');
    if (textEl) textEl.textContent = label;
  });
  if (selected) {
    const r = ROOMS.find(r => r.id === selected);
    if (r) $('#selectionhint').textContent = `${roomTitle(r)} · ${buildingName(r.building, r.floor)}`;
  }
}

function rebuildMarkers() {
  $('#markers').replaceChildren();
  for (const r of ROOMS) {
    const g = document.createElementNS(NS, 'g');
    g.classList.add('marker');
    g.dataset.id = r.id;
    g.style.setProperty('--color', colors[r.building] || '#619dff');
    g.setAttribute('transform', `translate(${r.x} ${r.y})`);
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.innerHTML = '<title></title><circle r="25"/><text x="37" y="11"></text>';
    g.onclick = e => {
      e.stopPropagation();
      if (!placing) select(r);
    };
    g.onkeydown = e => {
      if (!placing && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        select(r);
      }
    };
    $('#markers').append(g);
  }
  updateLabels();
  render();
  setView(view);
}

function showDetails(r) {
  $('#details').innerHTML = `<button class="close" aria-label="Lukk rominformasjon">×</button><span class="eyebrow" style="color:${colors[r.building]}">${buildingName(r.building, r.floor)} · ${r.floor}. ETASJE</span><h2>${escapeHTML(roomTitle(r))}</h2>${r.unnumbered ? '' : `<p class="roomname">${escapeHTML(roomName(r))}</p>`}<form id="nameform"><label for="roomname">Romnavn</label><div class="nameinput"><input id="roomname" maxlength="80" placeholder="Skriv et romnavn" autocomplete="off"></div><div class="editactions"><button type="submit" class="save">Lagre navn</button><button type="button" id="resetname">Originalnavn</button></div></form>${r.custom ? '<button id="deleteroom" class="danger">Fjern mitt rom</button>' : ''}<button type="button" id="addnear">Legg til rom her</button><p id="editstatus" role="status">${window.db ? 'Synkroniseres i sanntid via skyen.' : 'Lagres kun i denne nettleseren.'}</p>`;
  $('#addnear').onclick = startPlacement;
  $('#roomname').value = customNames[r.id] || (r.unnumbered ? r.name : '');
  $('#details .close').onclick = () => {
    selected = null;
    $('#details').replaceChildren();
    $('#selectionhint').textContent = 'Velg et rom for å se plasseringen';
    render();
  };
  $('#nameform').onsubmit = async e => {
    e.preventDefault();
    const name = $('#roomname').value.trim(), next = { ...customNames };
    if (name) next[r.id] = name; else delete next[r.id];
    if (await saveData(next)) {
      updateLabels();
      render();
      showDetails(r);
      $('#editstatus').textContent = 'Romnavnet er lagret for alle!';
    }
  };
  $('#resetname').onclick = async () => {
    const next = { ...customNames };
    delete next[r.id];
    if (await saveData(next)) {
      updateLabels();
      render();
      showDetails(r);
    }
  };
  if (r.custom) {
    $('#deleteroom').onclick = async () => {
      if (!confirm(`Fjerne «${roomName(r)}» fra kartet?`)) return;
      const nextNames = { ...customNames };
      delete nextNames[r.id];
      const nextRooms = customRooms.filter(x => x.id !== r.id);
      if (!await saveData(nextNames, nextRooms)) return;
      const idx = ROOMS.findIndex(x => x.id === r.id);
      if (idx !== -1) ROOMS.splice(idx, 1);
      selected = null;
      $('#details').replaceChildren();
      rebuildMarkers();
      status('Rommet er fjernet.');
    };
  }
}

function setView(v) {
  view = [...v];
  $('#map').setAttribute('viewBox', view.join(' '));
  $('#zoomlevel').textContent = Math.round(overview[2] / view[2] * 100) + ' %';
}

function setFloor(f, manual = true) {
  cancelPlacement();
  currentFloor = Number(f);
  selected = null;
  $('#details').replaceChildren();
  $('#planimage').setAttribute('href', floorImages[currentFloor]);
  $('#pinklabel').textContent = buildingName('P');
  $('#pinklegend').textContent = '● ' + buildingName('P');
  $('[data-building="P"]').textContent = buildingName('P');
  $('#floorcaption').textContent = `Fugleperspektiv · ${currentFloor}. etasje`;
  $('#sourcecaption').textContent = `Basert på «Full skole ${currentFloor} etg»`;
  document.querySelectorAll('[data-floor]').forEach(b => {
    const active = Number(b.dataset.floor) === currentFloor;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  if (manual) {
    $('#search').value = '';
    history.replaceState(null, '', '#etasje-' + currentFloor);
  }
  $('#maptitle').textContent = filter === 'all' ? 'Hele skolen' : buildingName(filter);
  $('#selectionhint').textContent = 'Velg et rom for å se plasseringen';
  setView(filter === 'all' ? overview : buildingViews[filter]);
  render();
}

function select(r) {
  cancelPlacement();
  if (r.floor !== currentFloor) setFloor(r.floor, false);
  if (filter !== 'all' && filter !== r.building) {
    filter = 'all';
    syncFilters();
  }
  selected = r.id;
  showDetails(r);
  setView([r.x - 750, r.y - 430, 1500, 860]);
  updateLabels();
  render();
  history.replaceState(null, '', '#' + r.id);
}

function syncFilters() {
  document.querySelectorAll('.filters button').forEach(b => b.classList.toggle('active', b.dataset.building === filter));
  $('#maptitle').textContent = filter === 'all' ? 'Hele skolen' : buildingName(filter);
}

$('.floor-switch').onclick = e => {
  const b = e.target.closest('[data-floor]');
  if (b) setFloor(b.dataset.floor);
};

$('.filters').onclick = e => {
  const b = e.target.closest('[data-building]');
  if (!b) return;
  cancelPlacement();
  filter = b.dataset.building;
  syncFilters();
  setView(filter === 'all' ? overview : buildingViews[filter]);
  render();
};

$('#search').oninput = render;
$('#clear').onclick = () => {
  $('#search').value = '';
  $('#search').focus();
  render();
};
$('#search').onkeydown = e => {
  if (e.key === 'Enter' && visible().length) select(visible()[0]);
  if (e.key === 'Escape') {
    $('#search').value = '';
    render();
  }
};

function zoom(f, cx = view[0] + view[2] / 2, cy = view[1] + view[3] / 2) {
  const w = Math.max(350, Math.min(14000, view[2] * f)), ratio = w / view[2];
  setView([cx + (view[0] - cx) * ratio, cy + (view[1] - cy) * ratio, w, view[3] * ratio]);
}

$('#plus').onclick = () => zoom(.7);
$('#minus').onclick = () => zoom(1 / .7);
$('#reset').onclick = () => setView(overview);

const svg = $('#map');
function point(e) {
  return new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
}

svg.addEventListener('wheel', e => {
  e.preventDefault();
  const p = point(e);
  zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, p.x, p.y);
}, { passive: false });

svg.onpointerdown = e => {
  if (e.target.closest('.marker') && !placing) return;
  drag = { x: e.clientX, y: e.clientY, v: [...view], moved: false };
  svg.setPointerCapture(e.pointerId);
  svg.classList.add('dragging');
};

svg.onpointermove = e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > 5) drag.moved = true;
  if (drag.moved) {
    const scale = svg.getScreenCTM().a;
    setView([drag.v[0] - dx / scale, drag.v[1] - dy / scale, drag.v[2], drag.v[3]]);
  }
};

svg.onpointerup = e => {
  const tap = drag && !drag.moved;
  drag = null;
  svg.classList.remove('dragging');
  if (placing && tap) openNewRoom(point(e));
};
svg.onpointercancel = () => {
  drag = null;
  svg.classList.remove('dragging');
};

$('#viewport').onkeydown = e => {
  if (e.key === 'Escape') cancelPlacement();
  if (e.target !== $('#viewport')) return;
  if (e.key === '+') zoom(.7);
  else if (e.key === '-') zoom(1 / .7);
  else if (e.key === 'Home') setView(overview);
  else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    setView([view[0] + (e.key === 'ArrowLeft' ? -.1 : e.key === 'ArrowRight' ? .1 : 0) * view[2], view[1] + (e.key === 'ArrowUp' ? -.1 : e.key === 'ArrowDown' ? .1 : 0) * view[3], view[2], view[3]]);
  }
};

function cancelPlacement() {
  placing = false;
  pendingPoint = null;
  $('#placementbar').hidden = true;
  svg.classList.remove('placing');
}

function startPlacement() {
  if (placing) {
    cancelPlacement();
    return;
  }
  placing = true;
  $('#placementbar').hidden = false;
  svg.classList.add('placing');
}
$('#cancelplace').onclick = cancelPlacement;

function inferBuilding(x, y) {
  return x > 6750 ? 'L' : x > 2750 && x < 3300 && y > 2500 ? 'P' : x < 2900 ? 'M' : 'T';
}

function openNewRoom(p) {
  if (p.x < 0 || p.x > 10000 || p.y < 0 || p.y > 4300) {
    status('Trykk innenfor plantegningen for å legge til et rom.');
    return;
  }
  pendingPoint = { x: Math.round(p.x), y: Math.round(p.y), floor: currentFloor };
  $('#newroomname').value = '';
  $('#newbuilding').value = inferBuilding(p.x, p.y);
  $('#newbuilding option[value="P"]').textContent = buildingName('P');
  $('#newfloor').textContent = currentFloor + '. etasje';
  $('#newerror').textContent = '';
  $('#newroomdialog').showModal();
  $('#newroomname').focus();
}

async function createCustomRoom(name, building, p) {
  name = name.trim();
  if (!name || name.length > 80 || !p) throw new Error('Skriv et romnavn.');
  const id = 'USER-' + p.floor + '-' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10));
  const r = { id, name, building, floor: p.floor, x: p.x, y: p.y, custom: true, unnumbered: true };
  validateRooms([r]);
  const nextRooms = [...customRooms, r];
  if (!await saveData(customNames, nextRooms)) return null;
  ROOMS.push(r);
  return r;
}

$('#newroomform').onsubmit = async e => {
  e.preventDefault();
  try {
    const r = await createCustomRoom($('#newroomname').value, $('#newbuilding').value, pendingPoint);
    if (!r) {
      $('#newerror').textContent = 'Rommet kunne ikke lagres.';
      return;
    }
    $('#newroomdialog').close();
    cancelPlacement();
    rebuildMarkers();
    select(r);
    status('Det nye rommet er lagret for alle.');
  } catch (err) {
    $('#newerror').textContent = err.message;
  }
};

$('#cancelnew').onclick = () => {
  $('#newroomdialog').close();
  pendingPoint = null;
};
$('#newroomdialog').oncancel = () => {
  pendingPoint = null;
};

// Start opp og sett opp lytter for Firebase
rebuildMarkers();
setFloor(location.hash === '#etasje-2' ? 2 : 1, false);
let hash = '';
try { hash = decodeURIComponent(location.hash.slice(1)); } catch { }
const linked = ROOMS.find(r => r.id === hash);
if (linked) select(linked);

setupFirebaseSync();
