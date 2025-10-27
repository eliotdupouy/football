const { useEffect, useMemo, useRef, useState } = React;

const APP_VERSION = 'v1.5.0';
const DATA_VERSION = (window.LIGUE1_DATA && window.LIGUE1_DATA.version) || 'legacy';

const MENTALITY_PROFILES = {
  Defensive: { attack: -0.6, defense: 0.9, card: -0.2 },
  Balanced: { attack: 0, defense: 0, card: 0 },
  Attacking: { attack: 0.8, defense: -0.5, card: 0.25 },
};

// Football Manager Lite — Sofascore fullscreen match feed
// Changes requested by user:
// - Rename "Jouer la ronde" -> "Play Match"
// - Remove "Simuler saison complète"
// - When "Play Match" is clicked, open a fullscreen Sofascore-like feed
//   that simulates the match minute-by-minute over ~5 minutes in realtime.
// - Support speed controls: x1 (default ~3.333s per match minute), x2, x4
// - Feed shows events with minute stamps, auto-scroll and animations (CSS),
//   and a final match summary before returning to the main UI.
// - All data still localStorage-persisted; no backend.

// --------------------------- DATA & HELPERS ---------------------------
const FALLBACK_PLAYERS = [
  { id: 1, name: "A. Goal", pos: "GK", rating: 65, age: 28 },
  { id: 2, name: "B. Wing", pos: "LB", rating: 60, age: 25 },
  { id: 3, name: "C. Steel", pos: "CB", rating: 62, age: 27 },
  { id: 4, name: "D. Wall", pos: "CB", rating: 63, age: 30 },
  { id: 5, name: "E. Pace", pos: "RB", rating: 61, age: 24 },
  { id: 6, name: "F. Ace", pos: "CM", rating: 64, age: 26 },
  { id: 7, name: "G. Link", pos: "CM", rating: 63, age: 29 },
  { id: 8, name: "H. Spark", pos: "LW", rating: 66, age: 23 },
  { id: 9, name: "I. Engine", pos: "AM", rating: 65, age: 27 },
  { id: 10, name: "J. Strike", pos: "RW", rating: 67, age: 29 },
  { id: 11, name: "K. Fin", pos: "ST", rating: 68, age: 24 },
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function normalizePlayerFromDataset(player, clubCode, index) {
  if (!player || typeof player !== 'object') {
    const fallback = FALLBACK_PLAYERS[index % FALLBACK_PLAYERS.length];
    return { ...fallback, id: `${clubCode}-fallback-${index}` };
  }

  const baseRating = typeof player.rating === 'number'
    ? player.rating
    : typeof player.attributes?.overall === 'number'
      ? player.attributes.overall
      : 70;

  const rating = clamp(Math.round(baseRating), 45, 95);
  const attributes = {
    pace: clamp(Math.round(player.attributes?.pace ?? rating + randInt(-12, 10)), 30, 99),
    shooting: clamp(Math.round(player.attributes?.shooting ?? rating + randInt(-10, 8)), 30, 95),
    passing: clamp(Math.round(player.attributes?.passing ?? rating + randInt(-8, 8)), 35, 95),
    dribbling: clamp(Math.round(player.attributes?.dribbling ?? rating + randInt(-8, 10)), 35, 96),
    defending: clamp(Math.round(player.attributes?.defending ?? rating + randInt(-12, 6)), 25, 92),
    physical: clamp(Math.round(player.attributes?.physical ?? rating + randInt(-10, 8)), 30, 95),
  };

  attributes.overall = clamp(Math.round(player.attributes?.overall ?? rating), 45, 95);

  return {
    id: player.id ?? `${clubCode}-p${index}`,
    name: player.name || `Player ${index + 1}`,
    pos: player.pos || 'CM',
    age: player.age ?? 24,
    rating,
    attributes,
  };
}

function deriveClubEconomics(players, team) {
  const avgRating = players.length
    ? players.reduce((sum, p) => sum + (p.rating || 0), 0) / players.length
    : 70;
  const balance = team.balance ?? Math.round(150000 + avgRating * 4500);
  const ticketsPrice = team.ticketsPrice ?? Math.max(12, Math.round(14 + (avgRating - 70) * 0.5));
  const sponsorMonthly = team.sponsor?.monthly ?? Math.round(4500 + avgRating * 120);
  const sponsorName = team.sponsor?.name || team.sponsorName || `${team.shortName || team.name} Partner`;

  return {
    balance,
    ticketsPrice,
    sponsor: team.sponsor ? { ...team.sponsor } : { name: sponsorName, monthly: sponsorMonthly },
  };
}

function buildDatasetClubs() {
  if (!window.LIGUE1_DATA || !Array.isArray(window.LIGUE1_DATA.teams)) {
    return [];
  }

  return window.LIGUE1_DATA.teams.map((team, idx) => {
    const clubCode = team.code || `club-${idx}`;
    const players = (team.players || []).map((player, playerIdx) => normalizePlayerFromDataset(player, clubCode, playerIdx));
    const economics = deriveClubEconomics(players, team);

    return {
      id: idx,
      code: clubCode,
      name: team.name || `Club ${idx + 1}`,
      shortName: team.shortName || team.name || `Club ${idx + 1}`,
      players,
      ...economics,
    };
  });
}

const DATASET_CLUBS = buildDatasetClubs();

function adjustPlayerRating(player, delta) {
  const rating = clamp((player?.rating ?? 60) + delta, 40, 99);
  const attributes = player?.attributes
    ? { ...player.attributes, overall: clamp((player.attributes.overall ?? rating) + delta, 40, 99) }
    : undefined;
  return { ...player, rating, attributes };
}

function formatPlayerAttributes(attributes) {
  if (!attributes) return '';
  return `PAC ${attributes.pace} SHO ${attributes.shooting} PAS ${attributes.passing} DRI ${attributes.dribbling} DEF ${attributes.defending} PHY ${attributes.physical}`;
}

function ensureClubProfile(club, idx) {
  const id = club.id ?? idx;
  const code = club.code || `club-${id}`;
  const name = club.name || `Club ${idx + 1}`;
  const shortName = club.shortName || name;
  const players = (club.players || []).map((player, playerIdx) => {
    const normalized = normalizePlayerFromDataset(player, code, playerIdx);
    const rating = typeof player?.rating === 'number' ? clamp(Math.round(player.rating), 40, 99) : normalized.rating;
    const attributes = {
      pace: clamp(Math.round(player?.attributes?.pace ?? normalized.attributes.pace), 30, 99),
      shooting: clamp(Math.round(player?.attributes?.shooting ?? normalized.attributes.shooting), 30, 95),
      passing: clamp(Math.round(player?.attributes?.passing ?? normalized.attributes.passing), 35, 95),
      dribbling: clamp(Math.round(player?.attributes?.dribbling ?? normalized.attributes.dribbling), 35, 96),
      defending: clamp(Math.round(player?.attributes?.defending ?? normalized.attributes.defending), 25, 92),
      physical: clamp(Math.round(player?.attributes?.physical ?? normalized.attributes.physical), 30, 95),
      overall: clamp(Math.round(player?.attributes?.overall ?? rating), 40, 99),
    };

    return {
      ...normalized,
      ...player,
      id: player?.id ?? normalized.id,
      rating,
      attributes,
    };
  });

  const economics = deriveClubEconomics(players, club);

  return {
    id,
    code,
    name,
    shortName,
    players,
    balance: club.balance ?? economics.balance,
    ticketsPrice: club.ticketsPrice ?? economics.ticketsPrice,
    sponsor: club.sponsor ? { ...club.sponsor } : economics.sponsor,
  };
}

function cloneClubCollection(source) {
  return source.map((club, idx) => ensureClubProfile(club, idx));
}

function createFallbackClubs() {
  const ai = ['Paris FC', 'Marseille B', 'Lille City', 'Nantes Town', 'Nice Rovers', 'Reims Athletic', 'Lyon Union'];
  return [
    {
      id: 0,
      name: 'FC Demo',
      shortName: 'FC Demo',
      balance: 200000,
      ticketsPrice: 15,
      sponsor: { name: 'NoSponsor', monthly: 5000 },
      players: FALLBACK_PLAYERS.map((p) => ({
        ...p,
        attributes: { pace: 60, shooting: 60, passing: 60, dribbling: 60, defending: 60, physical: 60, overall: p.rating },
      })),
    },
    ...ai.map((name, i) => ({
      id: i + 1,
      name,
      shortName: name,
      balance: 120000 + randInt(-25000, 25000),
      ticketsPrice: 12 + randInt(-2, 4),
      sponsor: { name: `Sponsor ${i + 1}`, monthly: 4000 + randInt(-1000, 2000) },
      players: FALLBACK_PLAYERS.map((p, idx) => {
        const rating = clamp(p.rating + randInt(-8, 10), 45, 82);
        return {
          ...p,
          id: `${i + 1}-${idx}`,
          rating,
          attributes: { pace: 60, shooting: 60, passing: 60, dribbling: 60, defending: 60, physical: 60, overall: rating },
        };
      }),
    })),
  ];
}

const DEFAULT_CLUBS = cloneClubCollection(DATASET_CLUBS.length ? DATASET_CLUBS : createFallbackClubs());

function createInitialMarket(clubsCollection) {
  const deals = [];
  clubsCollection.slice(1).forEach((club) => {
    if (!club.players || !club.players.length) return;
    const pick = club.players[randInt(0, club.players.length - 1)];
    deals.push({
      id: `${club.id}-${pick.id}`,
      fromClub: club.name,
      player: { ...pick, attributes: pick.attributes ? { ...pick.attributes } : undefined },
      price: Math.round(pick.rating * 1000 + randInt(-5000, 5000)),
    });
  });
  return deals;
}

function computeTeamStrength(players) {
  const weight = { GK: 0.9, CB: 1.0, LB: 0.95, RB: 0.95, CM: 1.05, AM: 1.05, LW: 1.1, RW: 1.1, ST: 1.15 };
  const sum = players.reduce((s, p) => s + p.rating * (weight[p.pos] || 1), 0);
  return sum / players.length;
}

function selectStartingXI(club) {
  return clone(club.players)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 11);
}

function getClubRank(clubName, table) {
  const index = table.findIndex((row) => row.team === clubName);
  return index === -1 ? null : index + 1;
}

function getRecentForm(clubName, fixtures, limit = 5) {
  const played = fixtures
    .filter((f) => f.played && (f.home === clubName || f.away === clubName))
    .sort((a, b) => b.round - a.round || (b.id > a.id ? 1 : -1));
  return played.slice(0, limit).map((fixture) => {
    const { homeGoals, awayGoals } = fixture.result;
    const isHome = fixture.home === clubName;
    const goalsFor = isHome ? homeGoals : awayGoals;
    const goalsAgainst = isHome ? awayGoals : homeGoals;
    if (goalsFor > goalsAgainst) return 'W';
    if (goalsFor < goalsAgainst) return 'L';
    return 'D';
  });
}

function getFormScore(formArray) {
  if (!formArray.length) return 0;
  return formArray.reduce((total, result) => {
    if (result === 'W') return total + 3;
    if (result === 'D') return total + 1;
    return total;
  }, 0) / formArray.length;
}

function pickOpponentMentality(club, opponent, leagueTable) {
  const clubStrength = computeTeamStrength(selectStartingXI(club));
  const opponentStrength = computeTeamStrength(selectStartingXI(opponent));
  const clubRank = getClubRank(club.name, leagueTable) || leagueTable.length / 2;
  const opponentRank = getClubRank(opponent.name, leagueTable) || leagueTable.length / 2;

  if (clubStrength > opponentStrength + 8 && (clubRank || 10) < (opponentRank || 10)) {
    return 'Attacking';
  }
  if (clubStrength + 6 < opponentStrength && (clubRank || 10) > (opponentRank || 10)) {
    return 'Defensive';
  }
  return 'Balanced';
}

function formatFormString(formArray) {
  return formArray && formArray.length ? formArray.join(' ') : 'No matches yet';
}

function deriveOdds(homeClub, awayClub, leagueTable, fixtures) {
  const homeStrength = computeTeamStrength(selectStartingXI(homeClub));
  const awayStrength = computeTeamStrength(selectStartingXI(awayClub));
  const homeRank = getClubRank(homeClub.name, leagueTable) || Math.ceil(leagueTable.length / 2) || 4;
  const awayRank = getClubRank(awayClub.name, leagueTable) || Math.ceil(leagueTable.length / 2) || 4;
  const homeForm = getFormScore(getRecentForm(homeClub.name, fixtures));
  const awayForm = getFormScore(getRecentForm(awayClub.name, fixtures));

  const ratingDiff = clamp((homeStrength - awayStrength) / 10, -2, 2);
  const rankDiff = clamp((awayRank - homeRank) / 5, -2, 2);
  const formDiff = clamp((homeForm - awayForm) / 3, -1.5, 1.5);

  let homeProb = 0.38 + ratingDiff * 0.06 - rankDiff * 0.04 + formDiff * 0.03;
  let awayProb = 0.32 - ratingDiff * 0.06 + rankDiff * 0.04 - formDiff * 0.03;
  let drawProb = 0.3;

  homeProb = clamp(homeProb, 0.15, 0.7);
  awayProb = clamp(awayProb, 0.15, 0.7);
  drawProb = clamp(drawProb + clamp(0.5 - (homeProb + awayProb), -0.1, 0.1), 0.1, 0.4);

  const total = homeProb + awayProb + drawProb;
  homeProb /= total;
  awayProb /= total;
  drawProb /= total;

  const toOdds = (prob) => (prob <= 0 ? '—' : (1 / prob).toFixed(2));

  return {
    homeProb,
    awayProb,
    drawProb,
    homeOdds: toOdds(homeProb),
    awayOdds: toOdds(awayProb),
    drawOdds: toOdds(drawProb),
  };
}

function computeMatchStatsForMinute(events, possessionLog, minute, homeName, awayName) {
  const upto = minute <= 0 ? 0 : minute;
  const stats = {
    home: { shots: 0, shotsOnTarget: 0, xg: 0, yellowCards: 0, possession: 0, goals: 0 },
    away: { shots: 0, shotsOnTarget: 0, xg: 0, yellowCards: 0, possession: 0, goals: 0 },
  };

  possessionLog
    .filter((entry) => entry.minute <= upto)
    .forEach((entry) => {
      stats[entry.team === homeName ? 'home' : 'away'].possession += entry.share;
    });

  events
    .filter((event) => event.minute <= upto)
    .forEach((event) => {
      const side = event.team === homeName ? 'home' : 'away';
      if (event.kind === 'goal' || event.kind === 'shot') {
        stats[side].shots += 1;
        if (event.onTarget || event.kind === 'goal') {
          stats[side].shotsOnTarget += 1;
        }
        if (typeof event.xg === 'number') {
          stats[side].xg += event.xg;
        }
        if (event.kind === 'goal') {
          stats[side].goals += 1;
        }
      }
      if (event.kind === 'yellow-card') {
        stats[side].yellowCards += 1;
      }
    });

  const totalPoss = stats.home.possession + stats.away.possession || 1;
  stats.home.possession = Math.round((stats.home.possession / totalPoss) * 100);
  stats.away.possession = Math.round((stats.away.possession / totalPoss) * 100);
  if (upto === 0) {
    stats.home.possession = 50;
    stats.away.possession = 50;
  }
  stats.home.xg = Number(stats.home.xg.toFixed(2));
  stats.away.xg = Number(stats.away.xg.toFixed(2));

  return stats;
}

function generateSeason(clubs) {
  const teams = clubs.map((c) => c.name);
  if (teams.length % 2 === 1) teams.push("BYE");
  const rounds = teams.length - 1; const half = teams.length / 2; const fixtures = [];
  const arr = teams.slice();
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < half; i++) {
      const home = arr[i]; const away = arr[arr.length - 1 - i];
      if (home !== "BYE" && away !== "BYE") {
        fixtures.push({ id: `${round}-${i}`, round: round + 1, home, away, played: false });
        fixtures.push({ id: `${round}-${i}-r`, round: round + 1 + rounds, home: away, away: home, played: false });
      }
    }
    arr.splice(1, 0, arr.pop());
  }
  fixtures.sort((a, b) => a.round - b.round);
  return fixtures;
}

// Create a full event stream for a match with live stats
function prepareMatchEventStream(home, away, context = {}) {
  const events = [];
  const possessionLog = [];
  const homeLineup = context.homeLineup || selectStartingXI(home);
  const awayLineup = context.awayLineup || selectStartingXI(away);
  const homeMentality = context.homeMentality || 'Balanced';
  const awayMentality = context.awayMentality || 'Balanced';
  const homeProfile = MENTALITY_PROFILES[homeMentality] || MENTALITY_PROFILES.Balanced;
  const awayProfile = MENTALITY_PROFILES[awayMentality] || MENTALITY_PROFILES.Balanced;

  const baseHomeStrength = computeTeamStrength(homeLineup);
  const baseAwayStrength = computeTeamStrength(awayLineup);
  const homeStrength = baseHomeStrength + homeProfile.attack * 1.8 - awayProfile.defense * 0.8 + (context.homeFormBoost || 0);
  const awayStrength = baseAwayStrength + awayProfile.attack * 1.8 - homeProfile.defense * 0.8 + (context.awayFormBoost || 0);
  const defensiveShieldHome = baseHomeStrength + homeProfile.defense * 1.5;
  const defensiveShieldAway = baseAwayStrength + awayProfile.defense * 1.5;

  let homeGoals = 0;
  let awayGoals = 0;
  let sequenceCounter = 0;

  function registerShot({ minute, isHome, onTargetChance, goalChance }) {
    const lineup = isHome ? homeLineup : awayLineup;
    const team = isHome ? home : away;
    const opponent = isHome ? away : home;
    const profile = isHome ? homeProfile : awayProfile;
    const shooter = lineup[randInt(0, Math.max(0, lineup.length - 1))];
    const onTargetProbability = clamp(onTargetChance + profile.attack * 0.04, 0.18, 0.82);
    const chanceOnTarget = Math.random() < onTargetProbability;
    const goalProbability = clamp(goalChance + profile.attack * 0.03 - (isHome ? awayProfile.defense : homeProfile.defense) * 0.025, 0.05, 0.65);
    const xg = clamp(goalProbability + Math.random() * 0.08, 0.03, 0.85);
    const isGoal = chanceOnTarget && Math.random() < goalProbability;

    if (isGoal) {
      if (isHome) homeGoals += 1; else awayGoals += 1;
    }

    const outcomeText = isGoal
      ? `${team.name} scores! ${shooter.name} finds the net. (${homeGoals}-${awayGoals})`
      : chanceOnTarget
        ? `${shooter.name} forces a save from ${opponent.name}.`
        : `${shooter.name} drags the attempt wide.`;

    events.push({
      minute,
      team: team.name,
      opponent: opponent.name,
      kind: isGoal ? 'goal' : 'shot',
      onTarget: chanceOnTarget || isGoal,
      xg,
      player: shooter.name,
      text: outcomeText,
      scoreboard: { homeGoals, awayGoals },
      sequence: sequenceCounter += 1,
    });
  }

  for (let minute = 1; minute <= 90; minute++) {
    const tempo = 1 + Math.sin((minute / 90) * Math.PI) * 0.18;
    const homePossChance = clamp(0.5 + (homeStrength - awayStrength) / 190 + homeProfile.attack * 0.05 - awayProfile.attack * 0.02, 0.34, 0.7);
    const hasHomeBall = Math.random() < homePossChance;
    possessionLog.push({ minute, team: hasHomeBall ? home.name : away.name, share: 1 });

    const homeAttackChance = clamp(0.08 + (homeStrength - awayStrength) / 220 + homeProfile.attack * 0.035 - awayProfile.defense * 0.02, 0.04, 0.22);
    const awayAttackChance = clamp(0.08 + (awayStrength - homeStrength) / 220 + awayProfile.attack * 0.035 - homeProfile.defense * 0.02, 0.04, 0.22);

    if (Math.random() < homeAttackChance * tempo * (hasHomeBall ? 1.1 : 0.9)) {
      const onTargetChance = 0.35 + (homeStrength - defensiveShieldAway) / 250;
      const goalChance = 0.18 + (homeStrength - defensiveShieldAway) / 260;
      registerShot({ minute, isHome: true, onTargetChance, goalChance });
    }

    if (Math.random() < awayAttackChance * tempo * (!hasHomeBall ? 1.1 : 0.9)) {
      const onTargetChance = 0.33 + (awayStrength - defensiveShieldHome) / 250;
      const goalChance = 0.17 + (awayStrength - defensiveShieldHome) / 260;
      registerShot({ minute, isHome: false, onTargetChance, goalChance });
    }

    const cardBase = 0.012 + Math.abs(homeProfile.card) * 0.004 + Math.abs(awayProfile.card) * 0.004;
    if (Math.random() < cardBase) {
      const isHomeCard = Math.random() < clamp(0.5 + homeProfile.card * 0.3 - awayProfile.card * 0.1, 0.25, 0.75);
      const lineup = isHomeCard ? homeLineup : awayLineup;
      const team = isHomeCard ? home : away;
      const player = lineup[randInt(0, Math.max(0, lineup.length - 1))];
      events.push({
        minute,
        team: team.name,
        kind: 'yellow-card',
        text: `Yellow card for ${player.name} (${team.name}).`,
        sequence: sequenceCounter += 1,
      });
    }

    if (Math.random() < 0.003) {
      const isHomeInjury = Math.random() < 0.5;
      const lineup = isHomeInjury ? homeLineup : awayLineup;
      const team = isHomeInjury ? home : away;
      const player = lineup[randInt(0, Math.max(0, lineup.length - 1))];
      events.push({
        minute,
        team: team.name,
        kind: 'injury',
        text: `${player.name} picks up a knock and needs treatment.`,
        sequence: sequenceCounter += 1,
      });
    }
  }

  if (Math.random() < 0.04) {
    const isHome = Math.random() < 0.5;
    const minute = 90;
    const onTargetChance = isHome ? 0.4 + (homeStrength - defensiveShieldAway) / 250 : 0.38 + (awayStrength - defensiveShieldHome) / 250;
    const goalChance = isHome ? 0.22 + (homeStrength - defensiveShieldAway) / 250 : 0.21 + (awayStrength - defensiveShieldHome) / 250;
    registerShot({ minute, isHome, onTargetChance, goalChance });
  }

  return {
    homeGoals,
    awayGoals,
    events: events.sort((a, b) => (a.minute === b.minute ? a.sequence - b.sequence : a.minute - b.minute)),
    score: `${homeGoals}-${awayGoals}`,
    possessionLog,
    lineups: { home: homeLineup, away: awayLineup },
    mentalities: { home: homeMentality, away: awayMentality },
  };
}

// --------------------------- COMPONENT ---------------------------
function FootballManagerLite() {
  const [clubs, setClubs] = useState(() => {
    const storedVersion = localStorage.getItem('fm_data_version');
    const raw = localStorage.getItem('fm_clubs');
    if (raw && storedVersion === DATA_VERSION) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          return cloneClubCollection(parsed);
        }
      } catch (err) {
        console.warn('Failed to parse stored clubs, regenerating', err);
      }
    }
    return cloneClubCollection(DEFAULT_CLUBS);
  });

  const playerClub = useMemo(()=> {
    if (!clubs.length) {
      return ensureClubProfile(DEFAULT_CLUBS[0], 0);
    }
    return clubs.find(c=>c.id===0) || clubs[0];
  }, [clubs]);

  const [fixtures, setFixtures] = useState(()=>{
    const storedVersion = localStorage.getItem('fm_data_version');
    const raw = localStorage.getItem('fm_fixtures_full');
    if (raw && storedVersion === DATA_VERSION) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (err) {
        console.warn('Failed to parse stored fixtures, regenerating', err);
      }
    }
    return generateSeason(DEFAULT_CLUBS);
  });

  const [market, setMarket] = useState(()=>{
    const storedVersion = localStorage.getItem('fm_data_version');
    const raw = localStorage.getItem('fm_market');
    if (raw && storedVersion === DATA_VERSION) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (err) {
        console.warn('Failed to parse stored market, regenerating', err);
      }
    }
    return createInitialMarket(DEFAULT_CLUBS);
  });

  const [log, setLog] = useState(()=>{ const raw = localStorage.getItem('fm_log'); return raw?JSON.parse(raw):[]; });
  const [mentality, setMentality] = useState(()=> localStorage.getItem('fm_mentality') || 'Balanced');
  const [currentRound, setCurrentRound] = useState(()=>{ const raw = localStorage.getItem('fm_currentRound'); return raw?Number(raw):1; });

  useEffect(()=>{ localStorage.setItem('fm_clubs', JSON.stringify(clubs)); }, [clubs]);
  useEffect(()=>{ localStorage.setItem('fm_data_version', DATA_VERSION); }, [clubs]);
  useEffect(()=>{ localStorage.setItem('fm_fixtures_full', JSON.stringify(fixtures)); }, [fixtures]);
  useEffect(()=>{ localStorage.setItem('fm_market', JSON.stringify(market)); }, [market]);
  useEffect(()=>{ localStorage.setItem('fm_log', JSON.stringify(log)); }, [log]);
  useEffect(()=>{ localStorage.setItem('fm_mentality', mentality); }, [mentality]);
  useEffect(()=>{ localStorage.setItem('fm_currentRound', String(currentRound)); }, [currentRound]);

  // --- Sofascore fullscreen state ---
  const [matchOverlay, setMatchOverlay] = useState(null);
  // matchOverlay = { fixtureId, homeClub, awayClub, stream: { events, homeGoals, awayGoals, score }, pointerMinute, playing, speed }

  const feedRef = useRef(null);
  const timerRef = useRef(null);

  function pushLog(text) { setLog(l=>[`${new Date().toLocaleString()}: ${text}`, ...l].slice(0,200)); }

  function changePlayerLocalRating(playerId, delta) {
    setClubs(cs=> cs.map(c=> c.id===0 ? {
      ...c,
      players: c.players.map(p=> (p.id === playerId ? adjustPlayerRating(p, delta) : p)),
    } : c));
  }

  function signPlayerFromMarket(itemId) {
    const item = market.find(m=>m.id===itemId); if(!item) return; const price = item.price; if(playerClub.balance < price) { pushLog(`Transfer failed: insufficient funds to buy ${item.player.name} (€${price})`); return; }
    setClubs(cs=> cs.map(c=> c.id===0 ? {
      ...c,
      players:[...c.players, { ...item.player, id: Date.now(), attributes: item.player.attributes ? { ...item.player.attributes } : undefined }],
      balance: c.balance - price
    } : c));
    setMarket(m=> m.filter(x=>x.id!==itemId)); pushLog(`Transfer: ${item.player.name} bought for €${price}`);
  }

  function listPlayerForSale(playerId, price) {
    const p = playerClub.players.find(pp=>pp.id===playerId); if(!p) return; const id = `${playerClub.name}-${playerId}-${Date.now()}`;
    setMarket(m=> [{ id, fromClub: playerClub.name, player: {...p, attributes: p.attributes ? { ...p.attributes } : undefined}, price }, ...m]);
    setClubs(cs=> cs.map(c=> c.id===0 ? {...c, players: c.players.filter(pp=>pp.id!==playerId)} : c)); pushLog(`${p.name} listed for sale for €${price}`);
  }

  // find next fixture in current round (first non-played)
  function getNextFixtureForRound(round = currentRound) {
    return fixtures.find(f=> f.round===round && !f.played) || null;
  }

  function buildMatchContext(homeClub, awayClub) {
    const homeLineup = selectStartingXI(homeClub);
    const awayLineup = selectStartingXI(awayClub);
    const homeMentality = homeClub.id === playerClub.id ? mentality : pickOpponentMentality(homeClub, awayClub, leagueTable);
    const awayMentality = awayClub.id === playerClub.id ? mentality : pickOpponentMentality(awayClub, homeClub, leagueTable);
    const homeForm = getFormScore(getRecentForm(homeClub.name, fixtures));
    const awayForm = getFormScore(getRecentForm(awayClub.name, fixtures));
    return {
      homeLineup,
      awayLineup,
      homeMentality,
      awayMentality,
      homeFormBoost: (homeForm - 1.5) * 1.2,
      awayFormBoost: (awayForm - 1.5) * 1.2,
    };
  }

  // Start a single match in overlay (prepares stream then plays)
  function startMatchOverlay(fx) {
    const homeClub = clubs.find(c=>c.name===fx.home); const awayClub = clubs.find(c=>c.name===fx.away);
    if(!homeClub || !awayClub) { pushLog('Unable to start match: clubs not found.'); return; }
    const context = buildMatchContext(homeClub, awayClub);
    const stream = prepareMatchEventStream(homeClub, awayClub, context);
    // set overlay state
    setMatchOverlay({ fixtureId: fx.id, home: homeClub, away: awayClub, stream, pointerMinute: 0, playing: true, speed: 1, displayedEvents: [], context });
  }

  // internal: advance one simulated minute (adds events for that minute to displayedEvents)
  function advanceMinute() {
    setMatchOverlay(mo=>{
      if(!mo) return mo;
      const nextMinute = mo.pointerMinute + 1;
      const eventsThisMinute = mo.stream.events.filter(e=> e.minute === nextMinute);
      const displayed = [...mo.displayedEvents, ...eventsThisMinute.map(e=> ({...e}))];
      // update score from stream by filtering events up to nextMinute
      const homeGoalsSoFar = mo.stream.events.filter(e=> e.kind==='goal' && e.team === mo.home.name && e.minute <= nextMinute).length;
      const awayGoalsSoFar = mo.stream.events.filter(e=> e.kind==='goal' && e.team === mo.away.name && e.minute <= nextMinute).length;
      // if match finished (90), mark played and apply econ/results
      if (nextMinute >= 90) {
        // finalize: mark fixture played and update clubs (income & ratings)
        const stats = computeMatchStatsForMinute(mo.stream.events, mo.stream.possessionLog, 90, mo.home.name, mo.away.name);
        finalizeMatch(mo.fixtureId, mo.home, mo.away, { homeGoals: homeGoalsSoFar, awayGoals: awayGoalsSoFar, events: mo.stream.events, stats });
        return { ...mo, pointerMinute: 90, displayedEvents: displayed, playing: false };
      }
      return { ...mo, pointerMinute: nextMinute, displayedEvents: displayed };
    });
  }

  function finalizeMatch(fixtureId, homeClub, awayClub, result) {
    const enrichedResult = { ...result, score: `${result.homeGoals}-${result.awayGoals}` };
    // update fixtures
    setFixtures(fs => fs.map(f=> f.id===fixtureId ? { ...f, played: true, result: enrichedResult } : f));
    // apply ticket income to home
    const attendance = Math.max(2000, Math.round(5000 + computeTeamStrength(homeClub.players) * 15 + randInt(-1000,1000)));
    const ticketIncome = Math.round(attendance * Math.max(1, homeClub.ticketsPrice));
    setClubs(cs => cs.map(c=> {
      if (c.name === homeClub.name) {
        const copy = {...c}; copy.balance = copy.balance + ticketIncome; // small rating changes
        if (result.homeGoals > result.awayGoals) {
          copy.players = copy.players.map(p=> (Math.random() < 0.15 ? adjustPlayerRating(p, 1) : p));
        } else if (result.awayGoals > result.homeGoals) {
          copy.players = copy.players.map(p=> (Math.random() < 0.08 ? adjustPlayerRating(p, -1) : p));
        }
        return copy;
      }
      if (c.name === awayClub.name) {
        const copy = {...c};
        if (result.awayGoals > result.homeGoals) {
          copy.players = copy.players.map(p=> (Math.random() < 0.15 ? adjustPlayerRating(p, 1) : p));
        } else if (result.homeGoals > result.awayGoals) {
          copy.players = copy.players.map(p=> (Math.random() < 0.08 ? adjustPlayerRating(p, -1) : p));
        }
        return copy;
      }
      return c;
    }));
    pushLog(`${homeClub.name} ${result.homeGoals} - ${result.awayGoals} ${awayClub.name} (gate: €${ticketIncome})`);
  }

  // controls: play/pause, speed change, finish early
  useEffect(()=>{
    if(!matchOverlay) { clearInterval(timerRef.current); timerRef.current = null; return; }
    if(!matchOverlay.playing) { clearInterval(timerRef.current); timerRef.current = null; return; }
    // base: 90 minutes -> 300 seconds (5 minutes) => 3333 ms per match-minute at x1
    const baseMs = 3333; // ~3.333 seconds per match minute
    const intervalMs = Math.max(50, Math.round(baseMs / matchOverlay.speed));
    clearInterval(timerRef.current);
    timerRef.current = setInterval(()=>{ advanceMinute(); }, intervalMs);
    return ()=> clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchOverlay && matchOverlay.playing, matchOverlay && matchOverlay.speed]);

  // autoscroll feed when new events appended
  useEffect(()=>{
    if(!feedRef.current) return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [matchOverlay && matchOverlay.displayedEvents && matchOverlay.displayedEvents.length]);

  function togglePlayPause() {
    setMatchOverlay(mo => mo ? { ...mo, playing: !mo.playing } : mo);
  }
  function setSpeed(s) { setMatchOverlay(mo => mo ? { ...mo, speed: s } : mo); }
  function finishMatchNow() {
    // show all remaining events and finalize
    setMatchOverlay(mo=>{
      if(!mo) return mo;
      const all = mo.stream.events;
      const homeGoals = all.filter(e=>e.kind==='goal' && e.team===mo.home.name).length;
      const awayGoals = all.filter(e=>e.kind==='goal' && e.team===mo.away.name).length;
      const stats = computeMatchStatsForMinute(all, mo.stream.possessionLog, 90, mo.home.name, mo.away.name);
      finalizeMatch(mo.fixtureId, mo.home, mo.away, { homeGoals, awayGoals, events: all, stats });
      const merged = new Map();
      [...mo.displayedEvents, ...all].forEach(ev=>{
        const key = `${ev.minute}-${ev.sequence || ev.player || ev.text}-${ev.team}`;
        merged.set(key, { ...ev });
      });
      const ordered = Array.from(merged.values()).sort((a,b)=> a.minute === b.minute ? ((a.sequence||0) - (b.sequence||0)) : a.minute - b.minute);
      return { ...mo, pointerMinute: 90, displayedEvents: ordered, playing: false };
    });
  }

  function closeOverlay() { setMatchOverlay(null); }

  // play match button: takes next fixture in round and starts overlay
  function onPlayMatchButton() {
    const fx = getNextFixtureForRound(currentRound);
    if(!fx) { pushLog('No match available for this round.'); return; }
    startMatchOverlay(fx);
  }

  function resetSeason() {
    if (!confirm('Reset the season?')) return;
    const refreshedClubs = cloneClubCollection(DEFAULT_CLUBS);
    setClubs(refreshedClubs);
    const freshFixtures = generateSeason(refreshedClubs);
    setFixtures(freshFixtures);
    setMarket(createInitialMarket(refreshedClubs));
    setCurrentRound(1);
    setMatchOverlay(null);
    setLog([]);
    pushLog('Season reset to the official Ligue 1 dataset.');
  }

  // UI helpers
  function addFreeAgent() {
    setMarket(m=> {
      const rating = clamp(55 + randInt(-5, 12), 45, 82);
      const attributes = {
        pace: clamp(rating + randInt(-10, 8), 40, 88),
        shooting: clamp(rating + randInt(-8, 8), 38, 86),
        passing: clamp(rating + randInt(-8, 8), 38, 86),
        dribbling: clamp(rating + randInt(-8, 8), 38, 88),
        defending: clamp(rating + randInt(-12, 6), 30, 82),
        physical: clamp(rating + randInt(-10, 8), 38, 88),
      };
      attributes.overall = rating;
      const pos = ['ST','CM','CB'][randInt(0,2)];
      const newPlayer = {
        id: Date.now(),
        name: `Free ${randInt(1,999)}`,
        pos,
        rating,
        age: 20 + randInt(0,10),
        attributes,
      };
      return [{ id:`free-${Date.now()}`, fromClub:'FreeAgent', player:newPlayer, price:20000 + randInt(-5000, 7000) }, ...m];
    });
  }
  function quickSponsor() { setClubs(c=> c.map(cl=> cl.id===0 ? {...cl, sponsor:{ name:`Sponsor ${randInt(1,99)}`, monthly:2000+randInt(0,8000) }} : cl)); }
  function adjustTicketPrice() { setClubs(c=> c.map(cl=> cl.id===0 ? {...cl, ticketsPrice: Math.max(5, cl.ticketsPrice + randInt(-2,2))} : cl)); }

  // derive league table
  const leagueTable = useMemo(()=>{
    const table = {}; clubs.forEach(c=> table[c.name] = { team:c.name, P:0,W:0,D:0,L:0,GF:0,GA:0,GD:0,Pts:0 });
    fixtures.filter(f=> f.played).forEach(f=>{ const home = table[f.home]; const away = table[f.away]; const hg = f.result.homeGoals; const ag = f.result.awayGoals; home.P++; away.P++; home.GF += hg; home.GA += ag; home.GD = home.GF - home.GA; away.GF += ag; away.GA += hg; away.GD = away.GF - away.GA; if(hg>ag){ home.W++; away.L++; home.Pts+=3 } else if(ag>hg){ away.W++; home.L++; away.Pts+=3 } else { home.D++; away.D++; home.Pts+=1; away.Pts+=1 } });
    return Object.values(table).sort((a,b)=> b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF);
  }, [clubs, fixtures]);

  const nextFixture = useMemo(()=> getNextFixtureForRound(), [fixtures, currentRound]);

  const matchPreview = useMemo(()=>{
    if(!nextFixture) return null;
    const homeClub = clubs.find(c=> c.name === nextFixture.home);
    const awayClub = clubs.find(c=> c.name === nextFixture.away);
    if(!homeClub || !awayClub) return null;
    const context = buildMatchContext(homeClub, awayClub);
    const odds = deriveOdds(homeClub, awayClub, leagueTable, fixtures);
    return {
      fixture: nextFixture,
      home: {
        club: homeClub,
        lineup: context.homeLineup,
        rank: getClubRank(homeClub.name, leagueTable),
        form: getRecentForm(homeClub.name, fixtures),
        mentality: context.homeMentality,
        avgRating: Math.round(computeTeamStrength(context.homeLineup)),
      },
      away: {
        club: awayClub,
        lineup: context.awayLineup,
        rank: getClubRank(awayClub.name, leagueTable),
        form: getRecentForm(awayClub.name, fixtures),
        mentality: context.awayMentality,
        avgRating: Math.round(computeTeamStrength(context.awayLineup)),
      },
      odds,
      playerSide: homeClub.id === playerClub.id ? 'home' : awayClub.id === playerClub.id ? 'away' : null,
    };
  }, [nextFixture, clubs, leagueTable, fixtures, mentality, playerClub]);

  const liveStats = (matchOverlay && matchOverlay.stream && matchOverlay.stream.possessionLog) ? computeMatchStatsForMinute(
    matchOverlay.stream.events,
    matchOverlay.stream.possessionLog,
    matchOverlay.pointerMinute,
    matchOverlay.home.name,
    matchOverlay.away.name,
  ) : null;

  // render
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white p-6 font-sans">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
        <main className="lg:col-span-3">
          <div className="bg-white rounded-2xl shadow p-4">
            <header className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-2xl font-bold">{playerClub.name} — Football Manager Lite</h1>
                <div className="text-sm text-slate-600">Balance: €{Math.round(playerClub.balance).toLocaleString()} — Sponsor: {playerClub.sponsor.name} (€{playerClub.sponsor.monthly}/month)</div>
              </div>
              <div className="space-x-2">
                <button onClick={()=>{ const idx = randInt(0, playerClub.players.length-1); const pid = playerClub.players[idx].id; changePlayerLocalRating(pid, randInt(1,3)); pushLog(`Training: ${playerClub.players[idx].name} improves form.`); }} className="px-3 py-1 rounded-lg border">Training</button>
                <button onClick={resetSeason} className="px-3 py-1 rounded-lg border text-red-600">Reset Season</button>
              </div>
            </header>

            {/* Squad + Transfers */}
            <section className="mb-4">
              <h2 className="font-semibold mb-2">Squad</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {playerClub.players.map(p=> (
                      <div key={p.id} className="flex items-center justify-between p-2 rounded-lg border">
                        <div>
                          <div className="font-medium">{p.name} <span className="text-sm text-slate-500">({p.pos})</span></div>
                          <div className="text-sm text-slate-600">OVR {p.rating} — Age {p.age}</div>
                          <div className="text-xs text-slate-500 uppercase">{formatPlayerAttributes(p.attributes)}</div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={()=>changePlayerLocalRating(p.id,-1)} className="px-2 py-1 rounded border">-</button>
                          <button onClick={()=>changePlayerLocalRating(p.id,1)} className="px-2 py-1 rounded border">+</button>
                          <button onClick={()=>listPlayerForSale(p.id, Math.round(p.rating*900))} className="px-2 py-1 rounded border text-amber-600">Sell</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-medium">Transfer Market</h3>
                  <div className="max-h-64 overflow-auto mt-2 border rounded p-2 bg-slate-50">
                    {market.length===0 ? <div className="text-sm text-slate-500">No players for sale right now.</div> : market.map(m=> (
                      <div key={m.id} className="p-2 rounded border bg-white mb-2">
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="font-medium">{m.player.name} — {m.player.pos}</div>
                            <div className="text-sm text-slate-600">From: {m.fromClub} — OVR {m.player.rating}</div>
                            <div className="text-xs text-slate-500 uppercase">{formatPlayerAttributes(m.player.attributes)}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium">{m.price}€</div>
                            <button onClick={()=>signPlayerFromMarket(m.id)} className="px-3 py-1 rounded mt-2 border bg-emerald-500 text-white">Buy</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Fixtures & Play Match */}
            <section className="mb-4">
              <h2 className="font-semibold mb-2">Season Schedule</h2>
              <div className="flex gap-2 items-center mb-3">
                <div>Current round: {currentRound}</div>
                <button onClick={onPlayMatchButton} className="px-3 py-1 rounded-lg bg-emerald-500 text-white">Play Match</button>
              </div>

              <div className="max-h-48 overflow-auto border rounded p-2 bg-slate-50">
                {fixtures.filter(f=> f.round>=currentRound && f.round< currentRound+3).map(f=> (
                  <div key={f.id} className="p-2 rounded border bg-white mb-2">
                    <div className="text-sm">R{f.round} — {f.home} vs {f.away} {f.played ? ` — ${f.result.score}` : ''}</div>
                    {f.played ? <div className="text-xs text-slate-600">Match already played</div> : null}
                  </div>
                ))}
              </div>
            </section>

            {matchPreview ? (
              <section className="mb-4">
                <h2 className="font-semibold mb-2">Match Preview</h2>
                <div className="border rounded-lg bg-slate-50 p-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="bg-white rounded-lg border p-3">
                      <div className="text-sm text-slate-500 mb-1">Home</div>
                      <div className="text-lg font-semibold">{matchPreview.home.club.name}</div>
                      <div className="text-sm text-slate-600">League rank: {matchPreview.home.rank || '—'}</div>
                      <div className="text-sm text-slate-600">XI rating: {matchPreview.home.avgRating}</div>
                      <div className="text-xs text-slate-500 mt-2">Last 5: {formatFormString(matchPreview.home.form)}</div>
                      <div className="text-xs text-slate-500 mt-1">Mentality: {matchPreview.home.club.id === playerClub.id ? mentality : matchPreview.home.mentality}</div>
                    </div>
                    <div className="bg-white rounded-lg border p-3">
                      <div className="text-sm font-semibold mb-2">Odds & Strategy</div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between"><span>Home</span><span>{matchPreview.odds.homeOdds}</span></div>
                        <div className="flex justify-between"><span>Draw</span><span>{matchPreview.odds.drawOdds}</span></div>
                        <div className="flex justify-between"><span>Away</span><span>{matchPreview.odds.awayOdds}</span></div>
                      </div>
                      {matchPreview.playerSide ? (
                        <div className="mt-3">
                          <div className="text-xs text-slate-500">Adjust team mentality</div>
                          <div className="flex gap-2 mt-2">
                            {['Defensive','Balanced','Attacking'].map(option => (
                              <button
                                key={option}
                                onClick={()=> setMentality(option)}
                                className={`px-3 py-1 rounded border ${mentality===option ? 'bg-emerald-500 text-white border-transparent' : ''}`}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                          <div className="text-xs text-slate-500 mt-2">Risk profile shifts chance of scoring or conceding.</div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 mt-3">You are observing this match as a neutral manager.</div>
                      )}
                    </div>
                    <div className="bg-white rounded-lg border p-3">
                      <div className="text-sm text-slate-500 mb-1">Away</div>
                      <div className="text-lg font-semibold">{matchPreview.away.club.name}</div>
                      <div className="text-sm text-slate-600">League rank: {matchPreview.away.rank || '—'}</div>
                      <div className="text-sm text-slate-600">XI rating: {matchPreview.away.avgRating}</div>
                      <div className="text-xs text-slate-500 mt-2">Last 5: {formatFormString(matchPreview.away.form)}</div>
                      <div className="text-xs text-slate-500 mt-1">Mentality: {matchPreview.away.club.id === playerClub.id ? mentality : matchPreview.away.mentality}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <div className="bg-white rounded-lg border p-3">
                      <div className="text-sm font-semibold mb-2">{matchPreview.home.club.name} XI</div>
                      <div className="space-y-1 text-xs text-slate-600">
                        {matchPreview.home.lineup.map(player => (
                          <div key={player.id} className="flex items-start justify-between gap-2">
                            <div>
                              <div>{player.name} ({player.pos})</div>
                              <div className="text-xs text-slate-500 uppercase">{formatPlayerAttributes(player.attributes)}</div>
                            </div>
                            <div className="font-medium">{player.rating}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white rounded-lg border p-3">
                      <div className="text-sm font-semibold mb-2">{matchPreview.away.club.name} XI</div>
                      <div className="space-y-1 text-xs text-slate-600">
                        {matchPreview.away.lineup.map(player => (
                          <div key={player.id} className="flex items-start justify-between gap-2">
                            <div>
                              <div>{player.name} ({player.pos})</div>
                              <div className="text-xs text-slate-500 uppercase">{formatPlayerAttributes(player.attributes)}</div>
                            </div>
                            <div className="font-medium">{player.rating}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {/* League Table */}
            <section>
              <h2 className="font-semibold mb-2">League Table</h2>
              <div className="overflow-auto border rounded">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="p-2 text-left">#</th>
                      <th className="p-2 text-left">Team</th>
                      <th className="p-2">P</th>
                      <th className="p-2">W</th>
                      <th className="p-2">D</th>
                      <th className="p-2">L</th>
                      <th className="p-2">GF</th>
                      <th className="p-2">GA</th>
                      <th className="p-2">GD</th>
                      <th className="p-2">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leagueTable.map((r,i)=> (
                      <tr key={r.team} className={`${r.team===playerClub.name? 'bg-amber-50':''}`}>
                        <td className="p-2">{i+1}</td>
                        <td className="p-2">{r.team}</td>
                        <td className="p-2 text-center">{r.P}</td>
                        <td className="p-2 text-center">{r.W}</td>
                        <td className="p-2 text-center">{r.D}</td>
                        <td className="p-2 text-center">{r.L}</td>
                        <td className="p-2 text-center">{r.GF}</td>
                        <td className="p-2 text-center">{r.GA}</td>
                        <td className="p-2 text-center">{r.GD}</td>
                        <td className="p-2 text-center font-medium">{r.Pts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

          </div>

          <div className="mt-4 bg-white rounded-2xl shadow p-4">
            <h3 className="font-semibold mb-2">Log & Events</h3>
            <div className="max-h-80 overflow-auto border rounded p-2 bg-slate-50">
              {log.length===0 ? <div className="text-sm text-slate-500">No events yet.</div> : log.map((l,i)=> <div key={i} className="text-sm py-0.5">{l}</div>)}
            </div>
          </div>
        </main>

        <aside>
          <div className="bg-white rounded-2xl shadow p-4 sticky top-6 w-full">
            <h3 className="font-semibold">Club snapshot</h3>
            <div className="mt-3 space-y-2">
              <div>Team strength: {Math.round(computeTeamStrength(playerClub.players))}</div>
              <div>Players: {playerClub.players.length}</div>
              <div>Ticket price: {playerClub.ticketsPrice}€</div>
              <div>Sponsor: {playerClub.sponsor.name} — €{playerClub.sponsor.monthly}/month</div>
            </div>

            <div className="mt-4">
              <h4 className="font-medium">Quick actions</h4>
              <div className="flex flex-col gap-2 mt-2">
                <button onClick={addFreeAgent} className="px-3 py-2 rounded border">Add free agent</button>
                <button onClick={quickSponsor} className="px-3 py-2 rounded border">Negotiate Sponsor (quick)</button>
                <button onClick={adjustTicketPrice} className="px-3 py-2 rounded border">Adjust ticket price</button>
              </div>
            </div>

            <div className="mt-4">
              <h4 className="font-medium">Local multiplayer / leagues</h4>
              <div className="text-sm text-slate-600 mt-2">The league runs locally. A real multiplayer mode would need a backend (auth + match management). For now each club represents a manager you can control manually.</div>
            </div>
          </div>
        </aside>
      </div>

      <footer className="max-w-7xl mx-auto mt-6 text-center text-sm text-slate-500">Release version: {APP_VERSION}</footer>

      {/* Fullscreen Match Overlay (Sofascore-like) */}
      {matchOverlay ? (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-80 flex flex-col text-white">
          <div className="p-4 flex items-center justify-between border-b border-white/10">
            <div>
              <div className="flex items-center gap-6">
                <div className="text-left">
                  <div className="text-xs text-white/50 uppercase">Home</div>
                  <div className="text-lg font-bold">{matchOverlay.home.name}</div>
                  <div className="text-xs text-white/60">Mentality: {matchOverlay.stream.mentalities ? matchOverlay.stream.mentalities.home : 'Balanced'}</div>
                </div>
                <div className="text-3xl font-extrabold">
                  {liveStats ? liveStats.home.goals : 0} - {liveStats ? liveStats.away.goals : 0}
                </div>
                <div className="text-right">
                  <div className="text-xs text-white/50 uppercase">Away</div>
                  <div className="text-lg font-bold">{matchOverlay.away.name}</div>
                  <div className="text-xs text-white/60">Mentality: {matchOverlay.stream.mentalities ? matchOverlay.stream.mentalities.away : 'Balanced'}</div>
                </div>
              </div>
              <div className="text-xs text-white/60 mt-2">Live xG: {liveStats ? liveStats.home.xg.toFixed(2) : '0.00'} - {liveStats ? liveStats.away.xg.toFixed(2) : '0.00'}</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm">{matchOverlay.pointerMinute > 0 ? `${matchOverlay.pointerMinute}’` : `0’`}</div>
              <button onClick={()=>{ finishMatchNow(); }} className="px-3 py-1 rounded border bg-white/10">Finish</button>
              <button onClick={()=>{ closeOverlay(); }} className="px-3 py-1 rounded border bg-white/5">Exit</button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="px-4 py-2">
            <div className="h-2 bg-white/10 rounded overflow-hidden">
              <div style={{ width: `${Math.min(100, Math.round((matchOverlay.pointerMinute/90)*100))}%` }} className="h-2 bg-emerald-400"></div>
            </div>
          </div>

          {/* Feed + controls */}
          <div className="flex-1 flex flex-col md:flex-row gap-4 p-4">
            <div className="flex-1 overflow-hidden">
              <div ref={feedRef} className="h-full overflow-auto bg-black/30 rounded p-3">
                {matchOverlay.displayedEvents.length===0 ? <div className="text-center text-sm text-white/70 mt-6">Match is starting…</div> : matchOverlay.displayedEvents.map((e,i)=> {
                  const icon = e.kind==='goal' ? '⚽' : e.kind==='yellow-card' ? '🟨' : e.kind==='injury' ? '🤕' : e.onTarget ? '🎯' : '•';
                  return (
                    <div key={`${e.sequence || i}-${e.minute}-${e.team}`} className="mb-3 p-2 bg-white/5 rounded">
                      <div className="flex items-center justify-between text-xs text-white/60">
                        <span>{e.minute}’</span>
                        <span>{e.team}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="text-sm font-medium">{icon}</div>
                        <div className="text-sm">{e.text}</div>
                      </div>
                      {typeof e.xg === 'number' && (e.kind==='goal' || e.kind==='shot') ? (
                        <div className="text-xs text-white/50 mt-1">xG: {e.xg.toFixed(2)}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="w-full md:w-80 space-y-3">
              <div className="bg-white/5 rounded p-3">
                <div className="text-sm mb-2">Controls</div>
                <div className="flex gap-2 mb-3">
                  <button onClick={togglePlayPause} className="px-3 py-1 rounded border">{matchOverlay.playing ? '⏸ Pause' : '▶ Resume'}</button>
                  <button onClick={()=>setSpeed(1)} className={`px-3 py-1 rounded border ${matchOverlay.speed===1? 'bg-emerald-500':''}`}>x1</button>
                  <button onClick={()=>setSpeed(2)} className={`px-3 py-1 rounded border ${matchOverlay.speed===2? 'bg-emerald-500':''}`}>x2</button>
                  <button onClick={()=>setSpeed(4)} className={`px-3 py-1 rounded border ${matchOverlay.speed===4? 'bg-emerald-500':''}`}>x4</button>
                </div>
                <div className="text-xs text-white/70">Sim speed adjusts how quickly in-game minutes elapse.</div>
                <div className="mt-3">
                  <button onClick={finishMatchNow} className="w-full px-3 py-2 rounded bg-emerald-500">Skip to end</button>
                </div>
              </div>

              <div className="bg-white/5 rounded p-3">
                <div className="text-sm mb-2">Live stats</div>
                {liveStats ? (
                  <div className="space-y-3 text-xs">
                    <div>
                      <div className="flex justify-between text-xs text-white/70">
                        <span>{matchOverlay.home.name}</span>
                        <span>{matchOverlay.away.name}</span>
                      </div>
                      <div className="h-2 bg-white/10 rounded overflow-hidden mt-1">
                        <div style={{ width: `${liveStats.home.possession}%` }} className="h-2 bg-emerald-400"></div>
                      </div>
                      <div className="flex justify-between text-xs text-white/60 mt-1">
                        <span>{liveStats.home.possession}%</span>
                        <span>{liveStats.away.possession}%</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between"><span>Shots</span><span>{liveStats.home.shots} - {liveStats.away.shots}</span></div>
                      <div className="flex justify-between"><span>On target</span><span>{liveStats.home.shotsOnTarget} - {liveStats.away.shotsOnTarget}</span></div>
                      <div className="flex justify-between"><span>Expected goals</span><span>{liveStats.home.xg.toFixed(2)} - {liveStats.away.xg.toFixed(2)}</span></div>
                      <div className="flex justify-between"><span>Yellow cards</span><span>{liveStats.home.yellowCards} - {liveStats.away.yellowCards}</span></div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-white/60">Stats will populate as the match begins.</div>
                )}
              </div>
            </div>
          </div>

          {/* Footer: final summary shown when playing=false and pointerMinute>=90 */}
          {(!matchOverlay.playing && matchOverlay.pointerMinute>=90) ? (
            <div className="p-4 border-t border-white/10 flex items-center justify-between">
              <div>
                <div className="text-lg font-bold">FULL TIME</div>
                <div className="text-sm">Final score: {matchOverlay.stream.homeGoals} - {matchOverlay.stream.awayGoals}</div>
                {liveStats ? (
                  <div className="text-xs text-white/60 mt-1">xG {liveStats.home.xg.toFixed(2)} - {liveStats.away.xg.toFixed(2)} • Shots {liveStats.home.shots} - {liveStats.away.shots}</div>
                ) : null}
              </div>
              <div>
                <button onClick={()=>{ closeOverlay(); setCurrentRound(r=> r+1); }} className="px-4 py-2 rounded bg-emerald-500">Back to season</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

window.FootballManagerLite = FootballManagerLite;
