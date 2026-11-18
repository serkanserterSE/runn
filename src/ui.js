import { RUNNER_DEFS, cssColor } from './config.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};
const MEDALS = ['🥇', '🥈', '🥉'];

/** Oyuncu adları kullanıcı girdisidir: DOM'a yalnızca textContent ile yazılır (innerHTML'e asla). */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function createUI({ getStandings, getName, onName, onVote }) {
  const $el = {
    hud: $('hud'), timeLeft: $('timeLeft'), progress: $('progress'), leaderName: $('leaderName'), leaderDist: $('leaderDist'), power: $('power'),
    countdown: $('countdown'), banner: $('banner'), tap: $('tap'),
    lobby: $('lobby'), lobbyMsg: $('lobbyMsg'), lobbyNum: $('lobbyNum'), lobbyUnit: $('lobbyUnit'), lobbyBig: $('lobbyBig'), lobbyList: $('lobbyList'), voteBtn: $('voteBtn'), steps: $('lobbySteps'),
    nameForm: $('nameForm'), nameInput: $('nameInput'),
    results: $('results'), resTitle: $('resTitle'), rankList: $('rankList'), totalList: $('totalList'), resTabs: $('resTabs'), resBar: $('resBar'),
    tkTrack: $('tkTrack'), nextIn: $('nextIn'), conn: $('conn'),
  };
  let phase = null;
  let seq = -1;
  let runners = null;
  const last = { time: '', leader: '', dist: '', progress: -1, count: null, next: -1, lobbyKey: '', lobbyT: '', power: -1 };

  // ---- Ad girişi
  $el.nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = $el.nameInput.value.trim();
    if (!n) return;
    $el.nameForm.hidden = true;
    onName(n);
  });
  // Oyun tuşları (boşluk) yazı alanındayken vuruş sayılmasın
  function askName() {
    $el.nameInput.value = getName() || '';
    $el.nameForm.hidden = false;
    $el.nameInput.focus();
  }

  function setCountdown(text) {
    if (text === last.count) return;
    last.count = text;
    $el.countdown.hidden = text == null;
    if (text == null) return;
    $el.countdown.textContent = text;
    $el.countdown.classList.remove('pop');
    void $el.countdown.offsetWidth;
    $el.countdown.classList.add('pop');
  }

  // ---- Lobi paneli: bekleme → oylama → geri sayım. DOM yalnızca liste/mesaj/sayaç değişince güncellenir.
  const stepEls = Object.fromEntries([...$el.steps.children].map((li) => [li.dataset.step, li]));
  $el.voteBtn.addEventListener('click', () => onVote(!lastLobby.myReady));
  let lastLobby = { myReady: false };

  function setStep(id, state, text) {
    const li = stepEls[id];
    li.className = state; // done | active | todo
    li.lastElementChild.textContent = text;
  }

  function renderLobby(s) {
    const L = s.lobby;
    lastLobby = L;
    const n = L.count, need = L.min;
    const key = `${L.players.map((p) => `${p[0]}:${p[1]}`).join('|')}#${L.stage}#${L.joined}#${L.myReady}#${L.practice}#${L.why}#${L.me}`;
    if (key !== last.lobbyKey) {
      last.lobbyKey = key;
      last.lobbyT = ''; // sayaç bu karede yeniden yazılsın
      let msg;
      switch (L.stage) {
        case 'waiting': msg = `Waiting for ${need - n} more player${need - n === 1 ? '' : 's'} — at least ${need} are needed`; break;
        case 'voting': msg = `Everyone must be ready (${L.ready}/${n}) — or the game starts automatically at ${s.n} players`; break;
        case 'queued': msg = 'The lobby is full — you play the next round'; break;
        case 'wait': msg = 'Opening the next lobby…'; break;
        default: msg = L.practice ? 'Practice mode: server unavailable — you race against bots' : L.why === 'full' ? 'Lobby full — starting automatically!' : 'Everyone is ready — get set!';
      }
      if (L.stage !== 'wait' && L.stage !== 'starting' && L.stage !== 'queued' && !L.joined && !L.practice) msg = 'Joining…';
      $el.lobbyMsg.textContent = msg;

      const starting = L.stage === 'starting';
      const voting = L.stage === 'voting';
      setStep('players', n >= need ? 'done' : 'active', `${n}/${need}${n >= s.n ? ' (full)' : ''}`);
      setStep('vote', starting ? 'done' : voting ? 'active' : 'todo', `${L.ready}/${Math.max(n, need)}`);
      setStep('start', starting ? 'active' : 'todo', starting ? '…' : '15 s');

      $el.lobbyList.replaceChildren(...L.players.map(([nm, ready, pub], i) => {
        const li = el('li');
        li.style.setProperty('--c', cssColor(RUNNER_DEFS[i].color));
        li.append(el('span', 'dot'), el('span', 'nm', nm));
        if (L.me && pub === L.me) li.append(el('em', null, 'you'));
        if (ready && !starting) li.append(el('span', 'rdy', '✓'));
        if (ready && !starting) li.classList.add('ready');
        return li;
      }));

      const b = $el.voteBtn;
      b.hidden = !(L.joined && !L.practice && (L.stage === 'waiting' || L.stage === 'voting'));
      b.disabled = L.stage === 'waiting';
      b.classList.toggle('on', L.myReady);
      b.textContent = L.stage === 'waiting' ? `Need ${need} players to vote` : L.myReady ? '✓ Ready — tap to cancel' : "I'm ready — start the game!";
    }
    // Büyük gösterge: oyuncu sayısı → hazır sayısı → geri sayım (saniye)
    let num, unit;
    if (L.stage === 'starting') { num = Math.ceil(s.nx ?? 0); unit = 's'; }
    else if (L.stage === 'voting') { num = `${L.ready}/${n}`; unit = 'ready'; }
    else if (L.stage === 'wait' || L.stage === 'queued') { num = ''; unit = ''; }
    else { num = `${n}/${need}`; unit = 'players'; }
    const t = `${num}${unit}`;
    if (t !== last.lobbyT) {
      last.lobbyT = t;
      $el.lobbyNum.textContent = num;
      $el.lobbyUnit.textContent = unit;
      $el.lobbyBig.hidden = num === '';
      $el.steps.children[2].lastElementChild.textContent = L.stage === 'starting' ? `${num}s` : '15 s';
    }
  }

  // ---- Sonuç sekmeleri: önce bu yarış, sonra kendiliğinden genel sonuç (kullanıcı dokunursa otomatik geçiş durur)
  let tabTimer = 0;
  let standingsReq = 0;
  function showTab(tab) {
    $el.rankList.hidden = tab !== 'race';
    $el.totalList.hidden = tab !== 'total';
    for (const b of $el.resTabs.children) b.classList.toggle('on', b.dataset.tab === tab);
  }

  // Sonuç görünümleri süreli dönüşümlü gösterilir: bu yarış → genel → bu yarış ...
  const VIEW_MS = 8000;
  const PANEL_DELAY = matchMedia('(prefers-reduced-motion: reduce)').matches ? 3000 : 8000; // style.css'teki panel gecikmesi
  const barFill = $el.resBar.firstElementChild;
  function cycle(tab, delay) {
    clearTimeout(tabTimer);
    showTab(tab);
    barFill.style.animation = 'none';
    void barFill.offsetWidth; // animasyonu yeniden başlat
    barFill.style.animation = `resBar ${VIEW_MS}ms linear ${delay}ms both`;
    tabTimer = setTimeout(() => cycle(tab === 'race' ? 'total' : 'race', 0), delay + VIEW_MS);
  }
  $el.resTabs.addEventListener('click', (e) => {
    const t = e.target.closest('button')?.dataset.tab;
    if (t && !$el.resBar.hidden) cycle(t, 0); // elle seçilen sekme kendi süresini yeniden başlatır
  });

  /** Bu yarışın sonuç satırları: rows = [[ad, mesafe, bot], ...] birinciden sonuncuya; me: vurgulanacak ad */
  function renderRace(rows, me, slotOf) {
    $el.rankList.replaceChildren(...rows.map(([name, dist, bot], i) => {
      const li = el('li');
      if (slotOf) li.style.setProperty('--c', cssColor(RUNNER_DEFS[slotOf[i]].color));
      if (!bot && name === me) li.classList.add('me');
      li.append(el('span', 'no', MEDALS[i] ?? i + 1), el('span', 'dot'), el('span', 'nm', name), el('span', 'ds', `${Math.round(dist)} m`));
      return li;
    }));
  }

  function renderStandings({ races, rows }) {
    const me = getName();
    $el.totalList.replaceChildren(...rows.map(([name, pts, wins, podiums], i) => {
      const li = el('li');
      if (name === me) li.classList.add('me');
      const ds = el('span', 'ds', `${pts} pts`);
      ds.append(el('small', null, `${wins} ${wins === 1 ? 'win' : 'wins'} · ${podiums} ${podiums === 1 ? 'podium' : 'podiums'}`));
      li.append(el('span', 'no', MEDALS[i] ?? i + 1), el('span', 'nm', name), ds);
      return li;
    }));
    return races;
  }

  // Üst şerit: genel sonuç, sağdan sola kayan yazı. DOM yalnızca veri değişince yeniden kurulur.
  const TICKER_PX_PER_S = 55;
  let tickerKey = '';
  function renderTicker({ races, rows }) {
    const key = JSON.stringify([races, rows]);
    if (key === tickerKey) return;
    tickerKey = key;
    const copy = el('span');
    if (!races) {
      copy.textContent = 'No races yet — overall standings will appear here after the first race';
    } else {
      copy.append(el('span', null, `After ${races} ${races === 1 ? 'race' : 'races'}:`));
      rows.slice(0, 10).forEach(([name, pts], i) => {
        const it = el('span', null, `${MEDALS[i] ?? `${i + 1}.`} ${name}`);
        it.append(el('em', null, `${pts} pts`));
        copy.append(it);
      });
    }
    // Dikişsiz döngü için aynı içerik iki kez; hız sabit (px/sn), süre içerik genişliğinden
    $el.tkTrack.replaceChildren(copy, copy.cloneNode(true));
    const w = Math.max(copy.getBoundingClientRect().width, 1);
    $el.tkTrack.style.setProperty('--tk-dur', (w / TICKER_PX_PER_S).toFixed(1) + 's');
  }

  async function loadStandings(withRace, round) {
    const req = ++standingsReq;
    try {
      const data = await getStandings(round);
      if (req !== standingsReq) return;
      renderTicker(data);
      const races = renderStandings(data);
      if (withRace && data.race) renderRace(data.race, getName()); // sunucunun kesin sonucu (istemci simülasyonundan çok az farklı olabilir)
      if (!races) { $el.resTabs.hidden = true; $el.resBar.hidden = true; showTab('race'); return; }
      $el.resTabs.children[1].textContent = `Overall (${races} ${races === 1 ? 'race' : 'races'})`;
      if (withRace) { $el.resBar.hidden = false; cycle('race', PANEL_DELAY); }
    } catch { /* ağ hatası: yalnızca bu yarışın sonucu gösterilir */ }
  }

  function enter(s) {
    const p = s.phase;
    const inRace = p === 'racing' || p === 'finishing';
    $el.hud.hidden = !inRace;
    $el.tap.hidden = p !== 'racing' || s.slot < 0;
    // Kutlama sahnesi görünsün: "FINISH!" kutlama boyunca kalır, sıralama paneli CSS ile gecikmeli açılır
    $el.banner.hidden = !(p === 'finishing' || (p === 'waiting' && s.res));
    $el.lobby.hidden = p !== 'lobby';
    $el.results.hidden = p !== 'waiting';
    $el.results.classList.toggle('late', p === 'waiting' && !!s.res);
    if (p !== 'countdown' && p !== 'racing') setCountdown(null);
    clearTimeout(tabTimer);
    last.lobbyKey = ''; last.lobbyT = '';
    if (p === 'waiting') {
      const hasRes = !!s.res;
      $el.resTabs.hidden = !hasRes;
      $el.resBar.hidden = true; // standings gelince (varsa) döngü başlar
      $el.resTitle.textContent = '🏆 Standings';
      renderRace(s.res.map(([slot, dist]) => [s.runners[slot].name, dist, s.runners[slot].bot]), getName(), s.res.map(([slot]) => slot));
      showTab('race');
      loadStandings(true, s.seq);
      last.next = -1;
    }
    last.time = ''; last.progress = -1; last.power = -1;
  }

  loadStandings(false, null); // açılışta şeridi doldur

  return {
    askName,
    setConnected(ok) { $el.conn.hidden = ok; },
    /** Her karede çağrılır; DOM yalnızca değer değişince güncellenir. */
    sync(s, live) {
      if (s.phase !== phase || s.seq !== seq) { phase = s.phase; seq = s.seq; enter(s); }
      runners = s.runners;
      if (s.slot !== last.slot) { last.slot = s.slot; $el.tap.hidden = phase !== 'racing' || s.slot < 0; }

      if (phase === 'lobby') {
        renderLobby(s);
      } else if (phase === 'countdown') {
        setCountdown(Math.max(1, Math.ceil(s.w)));
      } else if (phase === 'waiting') {
        const n = Math.max(0, Math.ceil(s.nx ?? 0));
        if (n !== last.next) { last.next = n; $el.nextIn.textContent = n; }
      } else {
        // racing / finishing
        const elapsed = Math.min(s.d, s.e);
        if (phase === 'racing') setCountdown(elapsed < 0.8 ? 'GO!' : null);
        const t = fmtTime(s.d - elapsed);
        if (t !== last.time) { last.time = t; $el.timeLeft.textContent = t; }
        const p = Math.round((elapsed / s.d) * 500) / 500;
        if (p !== last.progress) { last.progress = p; $el.progress.style.transform = `scaleX(${p})`; }

        let leader = live[0];
        for (let i = 0; i < s.n; i++) if (live[i].rank === 1) leader = live[i];
        const name = runners[leader.id].name;
        if (name !== last.leader) { last.leader = name; $el.leaderName.textContent = name; }
        const dd = Math.floor(leader.dist) + ' m';
        if (dd !== last.dist) { last.dist = dd; $el.leaderDist.textContent = dd; }

        if (s.slot >= 0) {
          const pw = Math.round(live[s.slot].boostLevel * 50) / 50;
          if (pw !== last.power) { last.power = pw; $el.power.style.transform = `scaleX(${pw})`; }
        }
      }
    },
  };
}
