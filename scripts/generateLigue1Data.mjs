
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SOURCE_ROOT = 'https://raw.githubusercontent.com/PabloJRW/FC25-Players-ETL/main/transformation/transformed_data/';
const TARGET_JSON = path.resolve('data/ligue1-2025-26.json');
const TARGET_JS = path.resolve('ligue1Data.js');
const REFERENCE_DATE = new Date('2025-09-01T00:00:00Z');
const TARGET_LEAGUE = "Ligue 1 McDonald's";

const TEAM_OVERRIDES = new Map([
  ['Paris SG', { name: 'Paris Saint-Germain', shortName: 'PSG', sponsorName: 'Qatar Airways' }],
  ['AS Monaco', { name: 'AS Monaco', shortName: 'Monaco', sponsorName: 'Fedcom' }],
  ['OM', { name: 'Olympique de Marseille', shortName: 'Marseille', sponsorName: 'CMA CGM' }],
  ['LOSC Lille', { name: 'LOSC Lille', shortName: 'Lille', sponsorName: 'Boulanger' }],
  ['OL', { name: 'Olympique Lyonnais', shortName: 'Lyon', sponsorName: 'Emirates' }],
  ['Stade Rennais FC', { name: 'Stade Rennais', shortName: 'Rennes', sponsorName: 'Samsic' }],
  ['Stade Brestois 29', { name: 'Stade Brestois 29', shortName: 'Brest', sponsorName: 'Brest\'aim' }],
  ['RC Lens', { name: 'RC Lens', shortName: 'Lens', sponsorName: 'Auchan' }],
  ['OGC Nice', { name: 'OGC Nice', shortName: 'Nice', sponsorName: 'INEOS' }],
  ['Montpellier', { name: 'Montpellier HSC', shortName: 'Montpellier', sponsorName: 'Partouche' }],
  ['Angers SCO', { name: 'Angers SCO', shortName: 'Angers', sponsorName: 'Scania' }],
  ['Havre AC', { name: 'Le Havre AC', shortName: 'Le Havre', sponsorName: 'Groupama' }],
  ['AJ Auxerre', { name: 'AJ Auxerre', shortName: 'Auxerre', sponsorName: 'Le Coq Sportif' }],
  ['Strasbourg', { name: 'RC Strasbourg Alsace', shortName: 'Strasbourg', sponsorName: 'Hager' }],
  ['Stade de Reims', { name: 'Stade de Reims', shortName: 'Reims', sponsorName: 'Hexaôm' }],
  ['Toulouse FC', { name: 'Toulouse FC', shortName: 'Toulouse', sponsorName: 'Onepoint' }],
  ['FC Nantes', { name: 'FC Nantes', shortName: 'Nantes', sponsorName: 'Synergie' }],
  ['AS Saint-Étienne', { name: 'AS Saint-Étienne', shortName: 'Saint-Étienne', sponsorName: 'ZEbet' }],
]);

const STAT_KEYS = new Set([
  'acceleration','sprintSpeed','agility','balance','ballControl','dribbling','reactions',
  'positioning','finishing','shotPower','longShots','volleys','penalties','vision','shortPassing',
  'longPassing','crossing','curve','freeKickAccuracy','headingAccuracy','jumping','stamina','strength',
  'aggression','interceptions','marking','standingTackle','slidingTackle','gkDiving','gkHandling','gkKicking',
  'gkReflexes','gkPositioning'
]);

function fetchText(url) {
  try {
    return execSync(`curl -sL ${url}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

function parseCSV(text) {
  const rows = [];
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return rows;
  const headers = splitCSVLine(lines[0]);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const fields = splitCSVLine(line);
    if (!fields.length) continue;
    const record = {};
    headers.forEach((header, idx) => {
      record[header] = fields[idx] ?? '';
    });
    rows.push(record);
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((value) => value.trim());
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'club';
}

function computeAge(birthdate) {
  const parts = birthdate.split(/[\/]/);
  if (parts.length < 3) return 24;
  const [month, day, yearPart] = parts;
  const yearMatch = String(yearPart).match(/\d{4}/);
  const year = yearMatch ? Number(yearMatch[0]) : Number(yearPart);
  const monthIndex = Number(month) - 1;
  const dayMatch = String(day).match(/\d{1,2}/);
  const dayNum = dayMatch ? Number(dayMatch[0]) : Number(day);
  if (Number.isNaN(year) || Number.isNaN(monthIndex) || Number.isNaN(dayNum)) return 24;
  const dob = new Date(Date.UTC(year, monthIndex, dayNum));
  let age = REFERENCE_DATE.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    REFERENCE_DATE.getUTCMonth() < dob.getUTCMonth() ||
    (REFERENCE_DATE.getUTCMonth() === dob.getUTCMonth() && REFERENCE_DATE.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return Math.max(16, Math.min(age, 40));
}

function average(values) {
  const filtered = values.filter((v) => Number.isFinite(v));
  if (!filtered.length) return 50;
  return filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
}

function computeAttributes(stats, rating) {
  const pace = average([stats.acceleration, stats.sprintSpeed]);
  const shooting = average([stats.finishing, stats.shotPower, stats.longShots, stats.positioning, stats.volleys, stats.penalties]);
  const passing = average([stats.shortPassing, stats.longPassing, stats.vision, stats.crossing, stats.curve, stats.freeKickAccuracy]);
  const dribbling = average([stats.dribbling, stats.ballControl, stats.agility, stats.balance, stats.reactions]);
  const defending = average([stats.interceptions, stats.marking, stats.standingTackle, stats.slidingTackle, stats.headingAccuracy]);
  const physical = average([stats.stamina, stats.strength, stats.aggression, stats.jumping]);
  const gk = average([stats.gkDiving, stats.gkHandling, stats.gkKicking, stats.gkReflexes, stats.gkPositioning]);
  const attributes = {
    pace: Math.round(pace || rating),
    shooting: Math.round(shooting || rating),
    passing: Math.round(passing || rating),
    dribbling: Math.round(dribbling || rating),
    defending: Math.round(defending || rating),
    physical: Math.round(physical || rating),
    goalkeeping: Math.round(gk || 0),
  };
  attributes.overall = Math.round(rating);
  return attributes;
}

function inferPosition(stats, footPref, attributes) {
  const rightFoot = footPref === '1' || footPref === 1 || footPref === 'Right';
  const gkScore = average([stats.gkDiving, stats.gkHandling, stats.gkKicking, stats.gkReflexes, stats.gkPositioning]);
  const cbScore = average([attributes.defending * 0.55, attributes.physical * 0.35, attributes.pace * 0.1]);
  let fbScore = average([attributes.pace * 0.35, attributes.defending * 0.25, attributes.passing * 0.2, attributes.dribbling * 0.2]);
  let cdmScore = average([attributes.defending * 0.4, attributes.physical * 0.3, attributes.passing * 0.3]);
  let cmScore = average([attributes.passing * 0.4, attributes.dribbling * 0.25, attributes.defending * 0.2, attributes.physical * 0.15]);
  const amScore = average([attributes.passing * 0.35, attributes.dribbling * 0.35, attributes.shooting * 0.2, attributes.pace * 0.1]);
  const defensiveStrength = attributes.defending || 0;
  const crossingAbility = stats.crossing ?? attributes.passing;
  if (defensiveStrength >= 70) {
    cdmScore += 4;
  } else if (defensiveStrength >= 63) {
    cdmScore += 2;
  }
  if (attributes.passing >= 78) {
    cmScore += 4;
  } else if (attributes.passing >= 72) {
    cmScore += 2;
  }
  let wingScore = average([attributes.pace * 0.4, attributes.dribbling * 0.35, attributes.passing * 0.25]);
  if (defensiveStrength >= 72) {
    fbScore += 6;
  } else if (defensiveStrength >= 65) {
    fbScore += 3;
  }
  if (crossingAbility >= 74) {
    fbScore += 4;
  } else if (crossingAbility >= 70) {
    fbScore += 1;
  } else {
    fbScore -= 4;
  }
  if (defensiveStrength >= 65 && defensiveStrength > attributes.dribbling) {
    wingScore -= 4;
  }
  let stScore = average([attributes.shooting * 0.45, attributes.pace * 0.25, attributes.physical * 0.2, attributes.dribbling * 0.1]);
  if (attributes.shooting >= 78) {
    stScore += (attributes.shooting - 75) * 0.18;
  }
  if (attributes.shooting - attributes.passing >= 8) {
    stScore += 4;
  }
  if (attributes.physical >= 78) {
    stScore += 3;
  }
  if (attributes.passing >= attributes.shooting + 5) {
    wingScore += 3;
  }
  const scores = [
    { pos: 'GK', value: gkScore },
    { pos: rightFoot ? 'RB' : 'LB', value: fbScore },
    { pos: 'CB', value: cbScore },
    { pos: 'CDM', value: cdmScore },
    { pos: 'CM', value: cmScore },
    { pos: 'AM', value: amScore },
    { pos: rightFoot ? 'RW' : 'LW', value: wingScore },
    { pos: 'ST', value: stScore },
  ];
  const best = scores.reduce((top, entry) => (entry.value > top.value ? entry : top), scores[0]);
  if (best.pos === 'GK' && gkScore < 55) {
    return 'CB';
  }
  if ((best.pos === 'RW' || best.pos === 'LW') && defensiveStrength >= 65) {
    const diff = wingScore - fbScore;
    if (diff < 6) {
      return rightFoot ? 'RB' : 'LB';
    }
  }
  if ((best.pos === 'RW' || best.pos === 'LW')) {
    const strikerLean = attributes.shooting - attributes.passing;
    if (attributes.shooting >= 75 && attributes.physical >= 65 && defensiveStrength < 60) {
      if (stScore >= wingScore - 3 || strikerLean >= 6) {
        return 'ST';
      }
    } else if (attributes.shooting >= 80 && attributes.physical >= 70) {
      if (stScore >= wingScore - 4) {
        return 'ST';
      }
    }
  }
  return best.pos;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildTeamFinancials(avgRating, override = {}) {
  const balance = override.balance ?? Math.round(160000 + (avgRating - 70) * 6000);
  const ticket = override.ticketsPrice ?? Math.round(clamp(18 + (avgRating - 68) * 0.4, 15, 42));
  const sponsorMonthly = override.sponsorMonthly ?? Math.round(60000 + (avgRating - 68) * 3200);
  const sponsorName = override.sponsorName ?? (override.shortName || 'Club') + ' Partners';
  return {
    balance: Math.max(95000, balance),
    ticketsPrice: ticket,
    sponsor: { name: sponsorName, monthly: Math.max(40000, sponsorMonthly) },
  };
}

async function main() {
  const [teamCSV, playerCSV, techCSV, statsCSV] = await Promise.all([
    fetchText(`${SOURCE_ROOT}team_data.csv`),
    fetchText(`${SOURCE_ROOT}player_data.csv`),
    fetchText(`${SOURCE_ROOT}player_technical_data.csv`),
    fetchText(`${SOURCE_ROOT}stats_data.csv`),
  ]);

  const teamRows = parseCSV(teamCSV).filter((row) => row.league_name === TARGET_LEAGUE);
  const targetPlayerIds = new Set(teamRows.map((row) => row.id_player));
  const playerRows = parseCSV(playerCSV).filter((row) => targetPlayerIds.has(row.id_player));
  const techRows = parseCSV(techCSV).filter((row) => targetPlayerIds.has(row.id_player));

  const stats = new Map();
  const lines = statsCSV.trim().split(/\r?\n/);
  const statHeaders = splitCSVLine(lines[0]);
  const statIndex = {
    id: statHeaders.indexOf('id_player'),
    key: statHeaders.indexOf('stats'),
    value: statHeaders.indexOf('stats_point'),
  };
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const parts = splitCSVLine(line);
    const id = parts[statIndex.id];
    if (!targetPlayerIds.has(id)) continue;
    const statName = parts[statIndex.key];
    if (!STAT_KEYS.has(statName)) continue;
    const value = Number(parts[statIndex.value]);
    if (!stats.has(id)) stats.set(id, {});
    stats.get(id)[statName] = value;
  }

  const basics = new Map();
  playerRows.forEach((row) => {
    basics.set(row.id_player, {
      firstName: row.first_name,
      lastName: row.last_name,
      commonName: row.common_name,
      height: Number(row.height) || null,
      weight: Number(row.weight) || null,
      birthdate: row.birthdate,
    });
  });

  const technical = new Map();
  techRows.forEach((row) => {
    technical.set(row.id_player, {
      overall: Number(row.overall_rating) || 70,
      preferredFoot: row.preferred_foot,
      weakFoot: Number(row.weak_foot_ability) || 3,
      skillMoves: Number(row.skill_moves) || 3,
    });
  });

  const teams = new Map();
  teamRows.forEach((row) => {
    const team = row.team;
    if (!teams.has(team)) teams.set(team, new Set());
    teams.get(team).add(row.id_player);
  });

  const leagueTeams = [];
  for (const [teamKey, rosterIds] of teams) {
    const override = TEAM_OVERRIDES.get(teamKey) || {};
    const players = [];
    for (const playerId of rosterIds) {
      const bio = basics.get(playerId);
      const tech = technical.get(playerId);
      if (!bio || !tech) continue;
      const statRecord = stats.get(playerId) || {};
      const rating = tech.overall || 70;
      const attributes = computeAttributes(statRecord, rating);
      const pos = inferPosition(statRecord, tech.preferredFoot, attributes);
      const age = computeAge(bio.birthdate);
      const displayName = (bio.commonName && bio.commonName.trim())
        || `${bio.firstName} ${bio.lastName}`.replace(/\s+/g, ' ').trim();
      players.push({
        id: `p${playerId}`,
        name: displayName,
        pos,
        age,
        rating: Math.round(rating),
        attributes: {
          pace: clamp(attributes.pace, 30, 99),
          shooting: clamp(attributes.shooting, 30, 99),
          passing: clamp(attributes.passing, 30, 99),
          dribbling: clamp(attributes.dribbling, 30, 99),
          defending: clamp(attributes.defending, 25, 99),
          physical: clamp(attributes.physical, 30, 99),
          overall: clamp(attributes.overall, 45, 99),
        },
        traits: {
          weakFoot: tech.weakFoot,
          skillMoves: tech.skillMoves,
          preferredFoot: tech.preferredFoot === '2' ? 'Left' : 'Right',
        },
      });
    }
    players.sort((a, b) => b.rating - a.rating);
    const avgRating = players.reduce((sum, p) => sum + p.rating, 0) / (players.length || 1);
    const financials = buildTeamFinancials(avgRating, { ...override, shortName: override.shortName || teamKey });
    const name = override.name || teamKey;
    const shortName = override.shortName || name;
    leagueTeams.push({
      code: slugify(name),
      name,
      shortName,
      ...financials,
      players,
    });
  }

  leagueTeams.sort((a, b) => {
    const ratingA = a.players.slice(0, 5).reduce((sum, p) => sum + p.rating, 0) / Math.max(1, Math.min(5, a.players.length));
    const ratingB = b.players.slice(0, 5).reduce((sum, p) => sum + p.rating, 0) / Math.max(1, Math.min(5, b.players.length));
    return ratingB - ratingA;
  });

  const generatedAt = new Date().toISOString();
  const dataset = {
    version: 'ligue1-2025-26-fifacm-r1',
    season: '2025-26',
    league: TARGET_LEAGUE,
    generatedAt,
    source: {
      site: 'https://www.fifacm.com',
      repository: 'PabloJRW/FC25-Players-ETL',
      fetchedAt: generatedAt
    },
    teams: leagueTeams,
  };

  fs.mkdirSync(path.dirname(TARGET_JSON), { recursive: true });
  fs.writeFileSync(TARGET_JSON, JSON.stringify(dataset, null, 2));

  const jsPayload = `(() => {\n  const data = ${JSON.stringify(dataset, null, 2)};\n  window.LIGUE1_DATA = data;\n})();\n`;
  fs.writeFileSync(TARGET_JS, jsPayload);

  console.log(`Generated ${leagueTeams.length} Ligue 1 teams with ${leagueTeams.reduce((sum, t) => sum + t.players.length, 0)} players.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
