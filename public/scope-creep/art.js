// Scope Creep's illustrations, as inline SVG strings: the duck you play, and a backdrop for each
// act. Scenes are drawn wide and anchored to the bottom, so they crop gracefully on any screen.

// The player: a duck in charge of sustainability, with a lanyard and a clipboard.
export function duckSVG() {
  return `<svg viewBox="0 0 220 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="dbody" cx="0.38" cy="0.32" r="0.8"><stop offset="0" stop-color="#FFF0A3"/><stop offset="0.55" stop-color="#FFD23F"/><stop offset="1" stop-color="#E9A80E"/></radialGradient>
    <radialGradient id="dhead" cx="0.4" cy="0.3" r="0.75"><stop offset="0" stop-color="#FFF4B8"/><stop offset="0.6" stop-color="#FFD23F"/><stop offset="1" stop-color="#EDAE14"/></radialGradient>
    <linearGradient id="dbill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFA640"/><stop offset="1" stop-color="#E8741A"/></linearGradient>
    <linearGradient id="dclip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C98A4B"/><stop offset="1" stop-color="#9C6430"/></linearGradient>
  </defs>
  <ellipse cx="108" cy="228" rx="70" ry="9" fill="#000" opacity="0.28"/>
  <g class="feet" fill="#F08A24">
    <path d="M78 214 q-6 12 -20 14 h34 q-4 -6 -6 -14z"/><path d="M128 214 q-6 12 -20 14 h34 q-4 -6 -6 -14z"/>
  </g>
  <path d="M40 150 C 34 104, 78 86, 118 92 C 168 98, 196 132, 186 170 C 178 206, 142 222, 104 220 C 64 218, 44 190, 40 150 Z" fill="url(#dbody)"/>
  <path d="M42 150 C 30 150, 18 142, 16 128 C 30 132, 38 128, 46 120 Z" fill="#F0B61E"/>
  <path d="M96 150 C 110 128, 150 128, 164 150 C 160 176, 128 190, 102 180 C 90 172, 90 160, 96 150 Z" fill="#F2BC22" opacity="0.9"/>
  <g transform="rotate(-8 150 166)">
    <rect x="128" y="138" width="46" height="60" rx="5" fill="url(#dclip)"/>
    <rect x="133" y="146" width="36" height="46" rx="2" fill="#F7F3E8"/>
    <rect x="143" y="134" width="16" height="9" rx="3" fill="#8A8F94"/>
    <g stroke="#9BB2B8" stroke-width="2.4" stroke-linecap="round"><line x1="138" y1="156" x2="162" y2="156"/><line x1="138" y1="164" x2="158" y2="164"/><line x1="138" y1="172" x2="162" y2="172"/></g>
    <path d="M138 182 l5 5 l10 -12" stroke="#2F8F7B" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <path d="M150 150 C 176 140, 186 160, 172 172 C 160 180, 146 172, 150 150 Z" fill="#F4C12A"/>
  <circle cx="104" cy="64" r="44" fill="url(#dhead)"/>
  <path d="M86 102 C 92 118, 118 120, 126 104" stroke="#0F3B4C" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M84 104 L 98 150" stroke="#2F8FB0" stroke-width="5" stroke-linecap="round"/>
  <path d="M128 102 L 110 150" stroke="#2F8FB0" stroke-width="5" stroke-linecap="round"/>
  <rect x="92" y="146" width="26" height="32" rx="4" fill="#F7F3E8" stroke="#0F3B4C" stroke-width="2"/>
  <rect x="97" y="152" width="16" height="12" rx="2" fill="#5EC8E0"/>
  <rect x="97" y="168" width="16" height="3" rx="1.5" fill="#0F3B4C" opacity="0.5"/>
  <path d="M138 58 C 164 56, 178 64, 176 74 C 172 84, 150 82, 136 76 Z" fill="url(#dbill)"/>
  <path d="M138 74 C 152 80, 166 80, 174 76" stroke="#B85A10" stroke-width="2" fill="none" opacity="0.6"/>
  <g class="eye"><ellipse cx="118" cy="52" rx="8" ry="10" fill="#fff"/><circle cx="121" cy="54" r="5.5" fill="#1B2A30"/><circle cx="123" cy="51" r="1.8" fill="#fff"/></g>
  <path d="M104 38 C 112 32, 124 32, 130 38" stroke="#C78A0A" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.7"/>
  <path d="M96 22 C 100 12, 110 12, 112 20 C 106 18, 102 20, 96 22 Z" fill="#F0B61E"/>
</svg>`;
}

// A small duckling for the flock beside the player.
export function ducklingSVG() {
  return `<svg viewBox="0 0 40 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="20" cy="34" rx="13" ry="2.5" fill="#000" opacity="0.25"/><ellipse cx="18" cy="24" rx="13" ry="10" fill="#FFE066"/><circle cx="26" cy="12" r="8" fill="#FFE066"/><path d="M32 11 l7 2 l-7 3z" fill="#F08A24"/><circle cx="28" cy="10" r="1.8" fill="#1B2A30"/><path d="M8 20 q-4 2 -5 -2 q4 -1 6 -2z" fill="#F7CF3A"/></svg>`;
}

const rnd = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// The backdrop for an act. `heat` (0 up) warms the sky; bosses darken it.
export function sceneSVG(act, { boss = false, heat = 0 } = {}) {
  const warm = Math.min(1, heat / 6);
  const r = rnd(act * 97 + 13);
  const W = 1600, H = 900;
  const skies = {
    1: ['#123F52', '#2E6F7A', '#E0A45E'],
    2: ['#0B1D33', '#1A3A5C', '#5C6FA0'],
    3: ['#14324A', '#3C6E86', '#F0B57A'],
  }[act];
  const hot = ['#3A1C2E', '#8A3B3B', '#F07A45'];
  const mix = (a, b, k) => { const p = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); const x = p(a), y = p(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(',')})`; };
  const sky = skies.map((c, i) => mix(c, hot[i], warm * 0.7));
  const dim = boss ? 0.35 : 0;
  let back = '', mid = '', front = '', fx = '';

  if (act === 1) {
    // Distant factories with smokestacks; a fence and yard in front.
    for (let i = 0; i < 9; i++) {
      const x = i * 190 + r() * 60 - 40, w = 120 + r() * 90, h = 110 + r() * 120;
      back += `<rect x="${x}" y="${640 - h}" width="${w}" height="${h + 40}" fill="#1D4A58" opacity="0.9"/>`;
      back += `<path d="M${x} ${640 - h} l${w / 3} -26 v26 l${w / 3} -26 v26 l${w / 3} -26 v26z" fill="#1D4A58"/>`;
      if (r() < 0.7) {
        const sx = x + w * (0.2 + r() * 0.6), sh = 90 + r() * 110;
        back += `<rect x="${sx}" y="${640 - h - sh}" width="18" height="${sh}" fill="#18414E"/><rect x="${sx - 2}" y="${640 - h - sh}" width="22" height="8" fill="#9C4A3A"/>`;
        for (let k = 0; k < 5; k++) fx += `<circle class="smoke" style="animation-delay:${(-k * 1.6 - r() * 4).toFixed(1)}s" cx="${sx + 9 + k * 14}" cy="${640 - h - sh - 20 - k * 34}" r="${22 + k * 10}" fill="#C8CFCB" opacity="${0.22 - k * 0.035}"/>`;
      }
      for (let wy = 640 - h + 24; wy < 630; wy += 26) for (let wx = x + 12; wx < x + w - 12; wx += 22) if (r() < 0.25) back += `<rect x="${wx}" y="${wy}" width="8" height="10" fill="#F5C66B" opacity="0.55"/>`;
    }
    mid += `<rect x="0" y="600" width="${W}" height="80" fill="#1B3F49"/>`;
    for (let x = 0; x < W; x += 60) mid += `<line x1="${x}" y1="560" x2="${x}" y2="680" stroke="#27505A" stroke-width="4"/>`;
    mid += `<path d="M0 560 H${W} M0 620 H${W}" stroke="#2F5D68" stroke-width="3"/>`;
    for (let x = 0; x < W; x += 30) mid += `<path d="M${x} 560 l30 60 M${x + 30} 560 l-30 60" stroke="#2A5661" stroke-width="1.5" opacity="0.6"/>`;
    front += `<rect x="0" y="660" width="${W}" height="${H - 660}" fill="#2B3F44"/><rect x="0" y="660" width="${W}" height="10" fill="#3B5559"/>`;
    for (let i = 0; i < 14; i++) front += `<line x1="${i * 130 + r() * 40}" y1="${700 + r() * 150}" x2="${i * 130 + 60 + r() * 40}" y2="${700 + r() * 150}" stroke="#E9C46A" stroke-width="6" opacity="0.18"/>`;
    front += `<ellipse cx="${W * 0.58}" cy="790" rx="190" ry="26" fill="#6FA7B5" opacity="0.18"/>`;
  }
  if (act === 2) {
    // Night: cooling towers with steam, pylons and power lines, a city far off.
    for (let i = 0; i < 60; i++) back += `<circle cx="${r() * W}" cy="${r() * 360}" r="${r() * 1.6 + 0.4}" fill="#fff" opacity="${0.3 + r() * 0.5}"/>`;
    for (let i = 0; i < 40; i++) { const x = r() * W, h = 30 + r() * 90; back += `<rect x="${x}" y="${600 - h}" width="${20 + r() * 30}" height="${h}" fill="#14294A"/>`; if (r() < 0.6) back += `<rect x="${x + 6}" y="${600 - h + 10}" width="4" height="5" fill="#FFD27A" opacity="0.7"/>`; }
    for (const [cx, s] of [[260, 1], [470, 0.8], [1250, 1.1]]) {
      back += `<path d="M${cx - 90 * s} 620 C ${cx - 60 * s} ${520 - 60 * s}, ${cx - 60 * s} ${470 - 40 * s}, ${cx - 70 * s} ${400 - 60 * s} H ${cx + 70 * s} C ${cx + 60 * s} ${470 - 40 * s}, ${cx + 60 * s} ${520 - 60 * s}, ${cx + 90 * s} 620 Z" fill="#23385A"/>`;
      for (let k = 0; k < 5; k++) fx += `<circle class="smoke" style="animation-delay:${(-k * 1.9 - r() * 4).toFixed(1)}s" cx="${cx + k * 18}" cy="${380 - 60 * s - k * 40}" r="${40 * s + k * 14}" fill="#DDE6F0" opacity="${0.2 - k * 0.03}"/>`;
    }
    const pylon = (x, s) => `<g transform="translate(${x} ${660}) scale(${s})" stroke="#4A6A92" stroke-width="${3 / s}" fill="none"><path d="M-40 0 L -8 -300 L 8 -300 L 40 0 M -30 -80 H 30 M -22 -160 H 22 M -60 -230 H 60 M -45 -280 H 45 M -40 0 L 22 -160 M 40 0 L -22 -160 M -30 -80 L 16 -230 M 30 -80 L -16 -230"/></g>`;
    const pylons = [[180, 1.05], [720, 0.8], [1180, 0.95], [1520, 0.7]];
    for (const [x, s] of pylons) mid += pylon(x, s);
    for (let i = 0; i < pylons.length - 1; i++) {
      const [x1, s1] = pylons[i], [x2, s2] = pylons[i + 1];
      for (const dy of [-230, -280]) mid += `<path d="M${x1 + 60 * s1} ${660 + dy * s1} Q ${(x1 + x2) / 2} ${660 + dy * Math.min(s1, s2) + 60} ${x2 - 60 * s2} ${660 + dy * s2}" stroke="#6D8DB5" stroke-width="1.6" fill="none" opacity="0.7"/>`;
    }
    front += `<rect x="0" y="660" width="${W}" height="${H - 660}" fill="#182A40"/><rect x="0" y="660" width="${W}" height="8" fill="#26405E"/>`;
    for (let i = 0; i < 30; i++) front += `<rect x="${r() * W}" y="${680 + r() * 200}" width="${4 + r() * 10}" height="2" fill="#7FA0C8" opacity="0.25"/>`;
  }
  if (act === 3) {
    // A container port at dusk: stacks, cranes, a ship on the water.
    back += `<rect x="0" y="520" width="${W}" height="140" fill="#2E5B73"/>`;
    for (let i = 0; i < 8; i++) back += `<path d="M${r() * W} ${540 + r() * 100} h${60 + r() * 120}" stroke="#F4C58C" stroke-width="3" opacity="0.35"/>`;
    back += `<path d="M880 520 h520 l-40 60 h-450z" fill="#1E3A4A"/><rect x="960" y="470" width="120" height="50" fill="#1E3A4A"/><rect x="1000" y="430" width="30" height="40" fill="#1E3A4A"/>`;
    for (let k = 0; k < 9; k++) back += `<rect x="${1090 + k * 32}" y="${490 - (k % 3) * 14}" width="30" height="${30 + (k % 3) * 14}" fill="${['#8A3B3B', '#2F6F7B', '#B8873A'][k % 3]}" opacity="0.7"/>`;
    const crane = x => `<g stroke="#D26A3A" stroke-width="7" fill="none" stroke-linejoin="round"><path d="M${x} 660 V 300 M ${x + 70} 660 V 300 M ${x - 80} 300 H ${x + 260} M ${x} 300 L ${x + 35} 250 L ${x + 70} 300 M ${x} 420 H ${x + 70} M ${x} 540 H ${x + 70}"/><path d="M${x + 180} 300 V 380" stroke-width="3"/></g><rect x="${x + 165}" y="380" width="34" height="18" fill="#2F6F7B"/>`;
    mid += crane(120) + crane(560);
    const colours = ['#8A3B3B', '#2F6F7B', '#B8873A', '#5A6C8C', '#3E7A55', '#A24F2A'];
    for (let s = 0; s < 3; s++) {
      const x0 = [260, 780, 1300][s];
      for (let row = 0; row < 3 + (s % 2); row++) for (let c = 0; c < 4; c++) {
        const x = x0 + c * 58, y = 632 - row * 34;
        mid += `<rect x="${x}" y="${y}" width="56" height="32" fill="${colours[Math.floor(r() * colours.length)]}"/><path d="M${x + 8} ${y + 4} v24 M${x + 20} ${y + 4} v24 M${x + 32} ${y + 4} v24 M${x + 44} ${y + 4} v24" stroke="#000" stroke-width="2" opacity="0.18"/>`;
      }
    }
    front += `<rect x="0" y="660" width="${W}" height="${H - 660}" fill="#3A4448"/><rect x="0" y="660" width="${W}" height="10" fill="#E0B24A" opacity="0.8"/>`;
    for (let x = 0; x < W; x += 80) front += `<rect x="${x}" y="660" width="40" height="10" fill="#1E2A2E" opacity="0.7"/>`;
  }

  return `<svg class="scene" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="sky${act}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="0.55" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/></linearGradient>
    <radialGradient id="vig" cx="0.5" cy="0.45" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="${sky[2]}" stop-opacity="0"/><stop offset="0.72" stop-color="${sky[2]}" stop-opacity="${0.18 + warm * 0.2}"/><stop offset="1" stop-color="${sky[2]}" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky${act})"/>
  ${act !== 2 ? `<circle cx="${W * 0.72}" cy="${act === 1 ? 470 : 500}" r="${act === 1 ? 70 : 90}" fill="${mix('#FFE3A3', '#FF8C5A', warm)}" opacity="0.75"/>` : `<circle cx="${W * 0.8}" cy="150" r="42" fill="#E8EEF7" opacity="0.85"/>`}
  <g class="layer back">${back}</g>
  <g class="layer fx" filter="url(#soft)">${fx}</g>
  <rect width="${W}" height="${H}" fill="url(#haze)"/>
  <g class="layer mid">${mid}</g>
  <g class="layer front">${front}</g>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
  ${dim ? `<rect width="${W}" height="${H}" fill="#1A0710" opacity="${dim}"/>` : ''}
</svg>`;
}
