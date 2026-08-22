// --- Supabase config (fill in with your project values) ---
// TODO: Replace these with your own Supabase URL and anon key.
const SUPABASE_URL = "https://wokarixqtacrqkupudom.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indva2FyaXhxdGFjcnFrdXB1ZG9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2MDA4NjAsImV4cCI6MjA3OTE3Njg2MH0.rJKRCRYyJnzMv2uAoQ4NqjGRbCSa3nvELedbJIOGyAk";

// --- Square config (client-safe: Application ID + Location ID are NOT secret) ---
const SQUARE_APPLICATION_ID = "sq0idp-q3md1Qjk_f8vDVLtja_e0Q";
const SQUARE_LOCATION_ID = "LHHF2CGR2B5YQ";
const SQUARE_WEB_SDK_URL = "https://web.squarecdn.com/v1/square.js";

let supabaseClient = null;

if (SUPABASE_URL !== "https://YOUR-PROJECT.supabase.co") {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ============================================
// ANTI-CHEAT SYSTEM
// ============================================
// Comprehensive bot detection and auto-ban for all games

const AntiCheat = {
  // Severity levels for auto-banning
  SEVERITY: {
    LOW: { score: 30, banDays: 0, warning: true },         // Warning only
    MEDIUM: { score: 50, banDays: 7, warning: true },      // 7 day ban
    HIGH: { score: 75, banDays: 30, warning: true },       // 30 day ban
    CRITICAL: { score: 100, banDays: 36500, warning: true } // Permanent ban (~100 years)
  },

  // Session tracking per game
  sessions: {},

  // Initialize a new anti-cheat session for a game
  createSession(gameType, matchId, playerId) {
    const sessionId = `${gameType}_${matchId}_${playerId}`;
    this.sessions[sessionId] = {
      gameType,
      matchId,
      playerId,
      startTime: Date.now(),
      clickIntervals: [],
      keyIntervals: [],
      actionTimestamps: [],
      suspicionScore: 0,
      flags: [],
      isFlagged: false,
      lastActionTime: 0
    };
    return sessionId;
  },

  // Get or create session
  getSession(gameType, matchId, playerId) {
    const sessionId = `${gameType}_${matchId}_${playerId}`;
    if (!this.sessions[sessionId]) {
      return this.createSession(gameType, matchId, playerId);
    }
    return sessionId;
  },

  // Record an action (click, keypress, etc.)
  recordAction(sessionId, actionType = 'click') {
    const session = this.sessions[sessionId];
    if (!session) return { allowed: true };

    const now = Date.now();
    const timeSinceLast = now - session.lastActionTime;

    if (session.lastActionTime > 0 && timeSinceLast > 0 && timeSinceLast < 2000) {
      if (actionType === 'click') {
        session.clickIntervals.push(timeSinceLast);
        if (session.clickIntervals.length > 30) session.clickIntervals.shift();
      } else {
        session.keyIntervals.push(timeSinceLast);
        if (session.keyIntervals.length > 30) session.keyIntervals.shift();
      }
      session.actionTimestamps.push(now);
      if (session.actionTimestamps.length > 100) session.actionTimestamps.shift();
    }

    session.lastActionTime = now;

    // Analyze if we have enough data
    if (session.clickIntervals.length >= 8 || session.keyIntervals.length >= 8) {
      return this.analyzePattern(sessionId);
    }

    return { allowed: true, suspicionScore: session.suspicionScore };
  },

  // Calculate statistical variance
  calculateStats(intervals) {
    if (intervals.length < 5) return { mean: 0, stdDev: 100, cv: 1 };
    
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const squaredDiffs = intervals.map(x => Math.pow(x - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 1;
    
    return { mean, stdDev, cv };
  },

  // Analyze click/action patterns for bot behavior
  analyzePattern(sessionId) {
    const session = this.sessions[sessionId];
    if (!session) return { allowed: true };

    const intervals = session.clickIntervals.length > 0 ? session.clickIntervals : session.keyIntervals;
    const { mean, stdDev, cv } = this.calculateStats(intervals);

    let scoreIncrease = 0;
    let flags = [];

    // DETECTION RULES
    
    // 1. Extremely consistent timing (robotic)
    if (cv < 0.05 && mean < 200) {
      scoreIncrease += 40;
      flags.push('ROBOTIC_TIMING');
    } else if (cv < 0.08 && mean < 150) {
      scoreIncrease += 25;
      flags.push('SUSPICIOUS_CONSISTENCY');
    } else if (cv < 0.12 && mean < 120) {
      scoreIncrease += 15;
      flags.push('LOW_VARIANCE');
    }

    // 2. Impossibly fast actions
    if (mean < 30) {
      scoreIncrease += 50;
      flags.push('SUPERHUMAN_SPEED');
    } else if (mean < 50) {
      scoreIncrease += 30;
      flags.push('VERY_FAST');
    }

    // 3. Perfect timing precision
    if (stdDev < 3 && mean < 150) {
      scoreIncrease += 35;
      flags.push('MACHINE_PRECISION');
    } else if (stdDev < 8 && mean < 100) {
      scoreIncrease += 20;
      flags.push('HIGH_PRECISION');
    }

    // 4. Check for repeated exact intervals (auto-clicker signature)
    const intervalCounts = {};
    intervals.forEach(i => {
      const rounded = Math.round(i / 5) * 5; // Round to nearest 5ms
      intervalCounts[rounded] = (intervalCounts[rounded] || 0) + 1;
    });
    const maxRepeats = Math.max(...Object.values(intervalCounts));
    if (maxRepeats >= intervals.length * 0.7) {
      scoreIncrease += 45;
      flags.push('REPEATED_INTERVAL');
    }

    // Natural behavior reduces suspicion
    if (cv > 0.3 && stdDev > 25) {
      session.suspicionScore = Math.max(0, session.suspicionScore - 5);
    }

    // Update session
    session.suspicionScore += scoreIncrease;
    session.flags = [...new Set([...session.flags, ...flags])];

    // Check thresholds and take action
    if (!session.isFlagged) {
      for (const [level, config] of Object.entries(this.SEVERITY)) {
        if (session.suspicionScore >= config.score) {
          session.isFlagged = true;
          session.flagLevel = level;
          this.handleDetection(session, level, { mean, stdDev, cv, flags });
          break;
        }
      }
    }

    return {
      allowed: !session.isFlagged,
      suspicionScore: session.suspicionScore,
      flags: session.flags,
      flagLevel: session.flagLevel
    };
  },

  // Handle detection - log, warn, and auto-ban
  async handleDetection(session, severityLevel, evidence) {
    const config = this.SEVERITY[severityLevel];
    
    console.warn(`[ANTI-CHEAT] ${severityLevel} detection for ${session.playerId}`, evidence);

    // Log to database
    try {
      await supabaseClient.from('cheat_logs').insert({
        player_id: session.playerId,
        username: currentUser?.username || 'Unknown',
        reason: `${severityLevel}_DETECTION`,
        data: JSON.stringify({
          gameType: session.gameType,
          matchId: session.matchId,
          clickIntervals: session.clickIntervals.slice(-20),
          flags: session.flags,
          evidence,
          suspicionScore: session.suspicionScore
        }),
        lobby_id: session.matchId,
        severity: severityLevel,
        auto_banned: config.banDays > 0
      });
    } catch (e) {
      console.error('[ANTI-CHEAT] Log error:', e);
    }

    // Auto-ban if severity warrants it
    if (config.banDays > 0) {
      await this.autoBan(session.playerId, config.banDays, severityLevel, session.flags);
    }

    // Show warning
    if (config.warning) {
      this.showWarning(severityLevel, config.banDays);
    }
  },

  // Auto-ban a player
  async autoBan(playerId, days, reason, flags) {
    const banUntil = new Date();
    banUntil.setDate(banUntil.getDate() + days);
    const banReason = `Auto-ban: ${reason} - ${flags.join(', ')}`;
    const durationText = days >= 365 ? (days >= 36500 ? 'Permanent' : `${Math.floor(days/365)} year(s)`) : `${days} days`;

    try {
      // Update profile ban status
      const { data: profile } = await supabaseClient.from('profiles').select('ban_count').eq('id', playerId).single();
      
      await supabaseClient.from('profiles').update({
        banned_until: banUntil.toISOString(),
        ban_reason: banReason,
        ban_count: (profile?.ban_count || 0) + 1
      }).eq('id', playerId);

      // Log to ban history
      await supabaseClient.from('ban_history').insert({
        player_id: playerId,
        username: currentUser?.username || 'Unknown',
        banned_by: 'Anti-Cheat System',
        ban_reason: banReason,
        ban_duration: durationText,
        banned_until: banUntil.toISOString()
      });

      console.warn(`[ANTI-CHEAT] Auto-banned ${playerId} for ${durationText}`);
    } catch (e) {
      console.error('[ANTI-CHEAT] Ban error:', e);
    }
  },

  // Show warning UI
  showWarning(severity, banDays) {
    const existing = document.getElementById('anticheat-warning');
    if (existing) existing.remove();

    const warning = document.createElement('div');
    warning.id = 'anticheat-warning';
    warning.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:99999;';
    
    const durationText = banDays >= 36500 ? 'permanently' : banDays >= 365 ? `for ${Math.floor(banDays/365)} year(s)` : `for ${banDays} day${banDays > 1 ? 's' : ''}`;
    const banText = banDays > 0 
      ? `<div style="color:#fbbf24;margin-top:1rem;">Your account has been suspended ${durationText}.</div>
         <div style="color:#9ca3af;font-size:0.9rem;margin-top:0.5rem;">If you believe this is an error, you can submit an appeal.</div>
         <button onclick="AntiCheat.showAppealForm()" style="margin-top:1rem;background:#6366f1;color:white;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-weight:bold;">Submit Appeal</button>`
      : `<div style="color:#fbbf24;margin-top:1rem;">This is a warning. Continued suspicious activity will result in a ban.</div>`;

    warning.innerHTML = `
      <div style="background:#1e293b;padding:2rem;border-radius:16px;text-align:center;max-width:500px;border:2px solid #dc2626;">
        <div style="font-size:3rem;">⚠️</div>
        <div style="color:#dc2626;font-size:1.5rem;font-weight:bold;margin-top:1rem;">Cheating Detected</div>
        <div style="color:#9ca3af;margin-top:1rem;">Our anti-cheat system has detected unusual activity that suggests the use of automated software or cheating tools.</div>
        ${banText}
        <button onclick="document.getElementById('anticheat-warning').remove()" style="margin-top:1rem;margin-left:0.5rem;background:#374151;color:white;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;">Close</button>
      </div>
    `;
    document.body.appendChild(warning);
  },

  // Show appeal form
  showAppealForm() {
    const warning = document.getElementById('anticheat-warning');
    if (warning) warning.remove();

    const form = document.createElement('div');
    form.id = 'appeal-form';
    form.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:99999;';
    form.innerHTML = `
      <div style="background:#1e293b;padding:2rem;border-radius:16px;max-width:500px;width:90%;">
        <div style="color:white;font-size:1.3rem;font-weight:bold;margin-bottom:1rem;">📝 Submit Appeal</div>
        <div style="color:#9ca3af;font-size:0.9rem;margin-bottom:1rem;">
          Please explain why you believe the detection was incorrect. Include any relevant details about your setup (mouse type, accessibility tools, etc.)
        </div>
        <textarea id="appeal-reason" placeholder="Explain your situation..." style="width:100%;height:120px;background:#0f172a;border:1px solid #374151;border-radius:8px;padding:12px;color:white;resize:none;font-family:inherit;" onkeydown="event.stopPropagation()" onkeyup="event.stopPropagation()" onkeypress="event.stopPropagation()"></textarea>
        <div style="margin-top:1rem;display:flex;gap:0.5rem;">
          <button onclick="AntiCheat.submitAppeal()" style="flex:1;background:#22c55e;color:white;border:none;padding:12px;border-radius:8px;cursor:pointer;font-weight:bold;">Submit Appeal</button>
          <button onclick="document.getElementById('appeal-form').remove()" style="background:#374151;color:white;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(form);
  },

  // Submit appeal to database
  async submitAppeal() {
    const reason = document.getElementById('appeal-reason')?.value;
    if (!reason || reason.trim().length < 10) {
      alert('Please provide more detail in your appeal.');
      return;
    }

    try {
      await supabaseClient.from('ban_appeals').insert({
        player_id: currentUser?.id,
        username: currentUser?.username,
        appeal_reason: reason.trim(),
        status: 'pending'
      });

      document.getElementById('appeal-form').remove();
      
      const success = document.createElement('div');
      success.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#22c55e;color:white;padding:20px 40px;border-radius:12px;z-index:99999;font-weight:bold;';
      success.textContent = '✓ Appeal submitted. We will review it within 24-48 hours.';
      document.body.appendChild(success);
      setTimeout(() => success.remove(), 4000);
    } catch (e) {
      console.error('Appeal error:', e);
      alert('Error submitting appeal. Please try again.');
    }
  },

  // Check if player is banned
  async checkBan(playerId) {
    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('banned_until, ban_reason')
        .eq('id', playerId)
        .single();

      if (error || !data) return { banned: false };

      if (data.banned_until && new Date(data.banned_until) > new Date()) {
        return {
          banned: true,
          until: data.banned_until,
          reason: data.ban_reason
        };
      }
      return { banned: false };
    } catch (e) {
      return { banned: false };
    }
  },

  // Show banned message
  showBannedMessage(banInfo) {
    const until = new Date(banInfo.until);
    const now = new Date();
    const diffMs = until - now;
    const diffMins = Math.ceil(diffMs / (1000 * 60));
    const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    
    // Format remaining time nicely
    let timeRemaining;
    if (diffMins < 60) {
      timeRemaining = `${diffMins} minute${diffMins !== 1 ? 's' : ''}`;
    } else if (diffHours < 24) {
      timeRemaining = `${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
    } else if (diffDays < 365) {
      timeRemaining = `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
    } else {
      timeRemaining = 'Permanent';
    }
    
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.95);display:flex;align-items:center;justify-content:center;z-index:99999;';
    modal.innerHTML = `
      <div style="background:#1e293b;padding:2rem;border-radius:16px;text-align:center;max-width:500px;border:2px solid #dc2626;">
        <div style="font-size:3rem;">🚫</div>
        <div style="color:#dc2626;font-size:1.5rem;font-weight:bold;margin-top:1rem;">Account Suspended</div>
        <div style="color:#9ca3af;margin-top:1rem;">Your account has been suspended for violating our fair play policy.</div>
        <div style="background:#0f172a;padding:1rem;border-radius:8px;margin-top:1rem;">
          <div style="color:#fbbf24;font-weight:bold;">Reason: ${banInfo.reason || 'Cheating detected'}</div>
          <div style="color:#9ca3af;margin-top:0.5rem;">Ban expires: ${until.toLocaleString()} (${timeRemaining} remaining)</div>
        </div>
        <button onclick="AntiCheat.showAppealForm(); this.closest('div[style*=fixed]').remove();" style="margin-top:1.5rem;background:#6366f1;color:white;border:none;padding:12px 32px;border-radius:8px;cursor:pointer;font-weight:bold;">Submit Appeal</button>
      </div>
    `;
    document.body.appendChild(modal);
    return false; // Player cannot play
  },

  // Clean up session
  endSession(sessionId) {
    delete this.sessions[sessionId];
  }
};

// Make AntiCheat globally accessible
window.AntiCheat = AntiCheat;

// Global function to check ban before starting any game
async function checkBanBeforeGame(gameName) {
  if (!currentUser) return true; // Allow if not logged in (will fail auth later)
  
  const banInfo = await AntiCheat.checkBan(currentUser.id);
  if (banInfo.banned) {
    AntiCheat.showBannedMessage(banInfo);
    return false;
  }
  return true;
}

// ============================================
// PROVABLY FAIR SYSTEM
// ============================================
// Cryptographic fairness verification for all games

const ProvablyFair = {
  // Generate a random seed (32 bytes hex)
  generateSeed: () => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  // Hash a string using SHA-256
  async hash(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  },

  // Create a new provably fair game session
  async createGame(gameType, gameId, playerId) {
    const serverSeed = this.generateSeed();
    const serverSeedHash = await this.hash(serverSeed);
    const clientSeed = this.generateSeed().substring(0, 16); // Shorter client seed
    
    // Store in database
    const { data, error } = await supabaseClient
      .from('provably_fair_games')
      .insert({
        game_type: gameType,
        game_id: gameId,
        server_seed: serverSeed,
        server_seed_hash: serverSeedHash,
        client_seed: clientSeed,
        player_id: playerId,
        nonce: 0
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating provably fair game:', error);
      return null;
    }
    
    return {
      id: data.id,
      serverSeedHash, // Show this to player BEFORE game
      clientSeed,
      serverSeed // Keep this hidden until game ends
    };
  },

  // Reveal the server seed after game ends
  async revealGame(provablyFairId) {
    const { data, error } = await supabaseClient
      .from('provably_fair_games')
      .update({
        is_revealed: true,
        revealed_at: new Date().toISOString()
      })
      .eq('id', provablyFairId)
      .select()
      .single();
    
    if (error) {
      console.error('Error revealing game:', error);
      return null;
    }
    
    return data;
  },

  // Verify a game outcome
  async verifyGame(serverSeed, serverSeedHash) {
    const calculatedHash = await this.hash(serverSeed);
    return calculatedHash === serverSeedHash;
  },

  // Generate a deterministic result from seeds (for game outcomes)
  async generateResult(serverSeed, clientSeed, nonce, range = 100) {
    const combined = `${serverSeed}:${clientSeed}:${nonce}`;
    const hash = await this.hash(combined);
    // Use first 8 chars of hash as hex number
    const num = parseInt(hash.substring(0, 8), 16);
    return num % range;
  },

  // Get verification data for a game
  async getVerificationData(gameId) {
    const { data, error } = await supabaseClient
      .from('provably_fair_games')
      .select('*')
      .eq('game_id', gameId)
      .single();
    
    if (error) {
      console.error('Error getting verification data:', error);
      return null;
    }
    
    return data;
  }
};

// Provably Fair UI Badge Component
function renderProvablyFairBadge(serverSeedHash, small = false) {
  const size = small ? 'font-size:0.7rem;padding:3px 8px;' : 'font-size:0.8rem;padding:4px 12px;';
  return `
    <div class="provably-fair-badge" style="display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#059669,#10b981);color:white;border-radius:20px;${size}cursor:pointer;" 
         title="Click to verify fairness">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <path d="M9 12l2 2 4-4"/>
      </svg>
      <span>Provably Fair</span>
    </div>
  `;
}

// Show provably fair info modal - make it globally accessible
// gameId = lobby ID, serverSeedHash = hash shown before, serverSeed = revealed after game
window.showProvablyFairInfo = function(serverSeedHash, serverSeed = null, gameId = null) {
  const existing = document.getElementById('provably-fair-modal');
  if (existing) existing.remove();

  const isRevealed = !!serverSeed;

  const modal = document.createElement('div');
  modal.id = 'provably-fair-modal';
  modal.className = 'auth-modal-overlay';
  modal.innerHTML = `
    <div class="auth-modal" style="max-width:520px;">
      <div class="auth-modal-header">
        <div class="auth-modal-title" style="display:flex;align-items:center;gap:8px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
          Provably Fair ${isRevealed ? '✓ Verified' : ''}
        </div>
        <button class="auth-modal-close" onclick="this.closest('.auth-modal-overlay').remove()">×</button>
      </div>
      
      <div style="padding:1rem;">
        <p style="color:#9ca3af;margin-bottom:1rem;font-size:0.9rem;">
          This game uses cryptographic verification to prove fairness. The outcome was determined 
          <strong>before</strong> the game started and cannot be manipulated.
        </p>
        
        ${gameId ? `
        <div style="background:#1e293b;border-radius:8px;padding:0.75rem;margin-bottom:0.75rem;">
          <div style="font-size:0.75rem;color:#9ca3af;margin-bottom:4px;">Game ID (for lookup)</div>
          <div style="font-family:monospace;font-size:0.75rem;word-break:break-all;color:#fbbf24;">
            ${gameId}
          </div>
        </div>
        ` : ''}
        
        <div style="background:#1e293b;border-radius:8px;padding:0.75rem;margin-bottom:0.75rem;">
          <div style="font-size:0.75rem;color:#9ca3af;margin-bottom:4px;">Server Seed Hash (shown before game)</div>
          <div style="font-family:monospace;font-size:0.75rem;word-break:break-all;color:#10b981;">
            ${serverSeedHash || 'Not available'}
          </div>
        </div>
        
        ${isRevealed ? `
        <div style="background:#1e293b;border-radius:8px;padding:0.75rem;margin-bottom:0.75rem;">
          <div style="font-size:0.75rem;color:#9ca3af;margin-bottom:4px;">Server Seed (revealed after game) ✓</div>
          <div style="font-family:monospace;font-size:0.75rem;word-break:break-all;color:#22c55e;">
            ${serverSeed}
          </div>
        </div>
        
        <div style="background:rgba(34,197,94,0.1);border:1px solid #22c55e;border-radius:8px;padding:0.75rem;margin-bottom:1rem;">
          <div style="color:#22c55e;font-weight:bold;margin-bottom:0.25rem;">✅ Ready to Verify</div>
          <div style="color:#9ca3af;font-size:0.85rem;">
            Copy both values above and paste them in the verification tool to prove this game was fair.
          </div>
        </div>
        ` : `
        <div style="background:rgba(251,191,36,0.1);border:1px solid #fbbf24;border-radius:8px;padding:0.75rem;margin-bottom:1rem;">
          <div style="color:#fbbf24;font-weight:bold;margin-bottom:0.25rem;">⏳ Game In Progress</div>
          <div style="color:#9ca3af;font-size:0.85rem;">
            The server seed will be revealed after the game ends. You can then verify the outcome was fair.
          </div>
        </div>
        `}
        
        <div style="font-size:0.85rem;color:#9ca3af;">
          <strong style="color:white;">How it works:</strong>
          <ol style="margin-top:0.5rem;padding-left:1.2rem;">
            <li>Before the game, we generate a secret seed and show you its hash</li>
            <li>After the game, we reveal the actual seed</li>
            <li>You can verify: hash(seed) = the hash we showed you</li>
            <li>This proves we couldn't have changed the outcome</li>
          </ol>
        </div>
        
        <div style="margin-top:1rem;text-align:center;">
          <a href="verify.html" target="_blank" class="btn btn-secondary" style="font-size:0.85rem;">
            Open Verification Tool →
          </a>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

let squareSdkLoadPromise = null;
function loadSquareSdk() {
  if (window.Square) return Promise.resolve(window.Square);
  if (squareSdkLoadPromise) return squareSdkLoadPromise;

  squareSdkLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SQUARE_WEB_SDK_URL;
    script.onload = () => {
      if (window.Square) resolve(window.Square);
      else reject(new Error("Square SDK failed to load"));
    };
    script.onerror = () => reject(new Error("Square SDK failed to load"));
    document.head.appendChild(script);
  });

  return squareSdkLoadPromise;
}

async function startCardDeposit(amountCash, sourceId) {
  if (!supabaseClient) return { ok: false, error: "Not connected" };

  const {
    data: { session },
    error: sessionError,
  } = await supabaseClient.auth.getSession();

  if (sessionError || !session || !session.access_token) {
    console.error("No auth session found for card deposit", sessionError);
    return { ok: false, error: "You must be logged in to deposit." };
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/create-square-payment`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ amountCash, sourceId }),
      }
    );

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("create-square-payment failed", res.status, json);
      return { ok: false, error: json?.error || "Payment failed. Please try again." };
    }

    await loadCurrentUser();
    return { ok: true };
  } catch (err) {
    console.error("Error calling create-square-payment", err);
    return { ok: false, error: "Failed to reach payment processor. Please try again." };
  }
}

function openDepositModal() {
  if (!supabaseClient) return;

  const existing = document.getElementById("deposit-modal-overlay");
  if (existing) existing.remove();

  let depositMethod = "btc"; // 'btc' | 'card'
  let squareCard = null;
  let squarePayments = null;

  const overlay = document.createElement("div");
  overlay.id = "deposit-modal-overlay";
  overlay.className = "auth-modal-overlay";
  overlay.innerHTML = `
    <div class="auth-modal">
      <div class="auth-modal-header">
        <div class="auth-modal-title">Add cash</div>
        <button class="auth-modal-close" id="deposit-modal-close">×</button>
      </div>
      <form id="deposit-form" class="auth-forms auth-forms-vertical">
        <label class="auth-field">
          <span class="auth-label">Amount (USD)</span>
          <input name="amount" type="number" min="1" step="1" placeholder="1" required />
        </label>
        <div class="small-text" style="margin-top:0.4rem;margin-bottom:0.2rem;">
          Choose payment method
        </div>
        <div style="display:flex;gap:0.4rem;margin-bottom:0.4rem;flex-wrap:wrap;">
          <button type="button" id="deposit-method-card" class="btn" style="padding:0.35rem 0.7rem;font-size:0.8rem;">Card</button>
          <button type="button" id="deposit-method-btc" class="btn btn-secondary" style="padding:0.35rem 0.7rem;font-size:0.8rem;">Bitcoin</button>
          <button type="button" class="btn btn-secondary" disabled style="opacity:0.55;padding:0.35rem 0.7rem;font-size:0.8rem;">Apple Pay (coming soon)</button>
          <button type="button" class="btn btn-secondary" disabled style="opacity:0.55;padding:0.35rem 0.7rem;font-size:0.8rem;">Google Pay (coming soon)</button>
        </div>
        <div id="square-card-container" style="display:none;margin-bottom:0.6rem;min-height:40px;"></div>
        <button class="btn" type="submit" id="deposit-submit" style="width:100%;margin-top:0.2rem;">Pay with Card</button>
      </form>
      <div id="deposit-error" class="error" style="margin-top:0.4rem;min-height:1.1em;"></div>
      <div class="small-text" style="margin-top:0.3rem;color:#9ca3af;">
        Minimum deposit is $1. Amounts must be whole dollars.
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => {
    if (squareCard) {
      try { squareCard.destroy(); } catch (e) { /* ignore */ }
    }
    overlay.remove();
  };

  const closeBtn = document.getElementById("deposit-modal-close");
  if (closeBtn) closeBtn.addEventListener("click", close);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const form = document.getElementById("deposit-form");
  const errorEl = document.getElementById("deposit-error");
  const submitBtn = document.getElementById("deposit-submit");
  const cardContainer = document.getElementById("square-card-container");
  const btcBtn = document.getElementById("deposit-method-btc");
  const cardBtn = document.getElementById("deposit-method-card");

  async function ensureSquareCard() {
    if (squareCard) return squareCard;
    if (errorEl) errorEl.textContent = "";
    try {
      const Square = await loadSquareSdk();
      squarePayments = Square.payments(SQUARE_APPLICATION_ID, SQUARE_LOCATION_ID);
      squareCard = await squarePayments.card();
      await squareCard.attach("#square-card-container");
      return squareCard;
    } catch (err) {
      console.error("Failed to initialize Square card form", err);
      if (errorEl) errorEl.textContent = "Could not load card payment form. Please try again.";
      return null;
    }
  }

  function setMethod(method) {
    depositMethod = method;
    if (cardBtn) cardBtn.className = method === "card" ? "btn" : "btn btn-secondary";
    if (btcBtn) btcBtn.className = method === "btc" ? "btn" : "btn btn-secondary";
    if (cardContainer) cardContainer.style.display = method === "card" ? "block" : "none";
    if (submitBtn) submitBtn.textContent = method === "card" ? "Pay with Card" : "Continue with Bitcoin";
    if (errorEl) errorEl.textContent = "";
    if (method === "card") ensureSquareCard();
  }

  if (cardBtn) cardBtn.addEventListener("click", () => setMethod("card"));
  if (btcBtn) btcBtn.addEventListener("click", () => setMethod("btc"));

  // Default to card since it's the fastest path; pre-load the SDK.
  setMethod("card");

  if (form && submitBtn) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!supabaseClient) return;

      const amountInput = /** @type {HTMLInputElement} */ (form.querySelector('input[name="amount"]'));
      const raw = amountInput && amountInput.value ? amountInput.value.trim() : "";
      const amount = Number(raw);

      if (!errorEl) return;
      errorEl.textContent = "";

      if (!Number.isFinite(amount) || amount < 1 || !Number.isInteger(amount)) {
        errorEl.textContent = "Enter a whole-dollar amount of at least $1.";
        return;
      }

      if (depositMethod === "card") {
        if (!squareCard) {
          errorEl.textContent = "Card form is still loading. Please try again in a moment.";
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Processing...";

        try {
          const result = await squareCard.tokenize();
          if (result.status !== "OK") {
            const detail = result.errors?.[0]?.message || "Card validation failed.";
            errorEl.textContent = detail;
            return;
          }

          const outcome = await startCardDeposit(amount, result.token);
          if (!outcome.ok) {
            errorEl.textContent = outcome.error || "Payment failed. Please try again.";
            return;
          }

          close();
        } catch (err) {
          console.error("Card deposit failed", err);
          errorEl.textContent = "Something went wrong. Please try again.";
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = "Pay with Card";
        }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Creating checkout...";

      startBitcoinDeposit(amount)
        .then((ok) => {
          if (!ok) {
            errorEl.textContent = "Could not create Bitcoin checkout. Please try again.";
            return;
          }
          close();
        })
        .catch((err) => {
          console.error("Failed to start Bitcoin deposit", err);
          if (errorEl) errorEl.textContent = "Failed to start deposit. Please try again.";
        })
        .finally(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = "Continue with Bitcoin";
        });
    });
  }
}

function openAuthModal(mode) {
  if (!authModalRoot) return;
  const modalMode = mode === "signup" ? "signup" : "login";

  if (modalMode === "login") {
    authModalRoot.innerHTML = `
      <div class="auth-modal-overlay" id="auth-modal-overlay">
        <div class="auth-modal">
          <div class="auth-modal-header">
            <div class="auth-modal-title">Sign In</div>
            <button class="auth-modal-close" id="auth-modal-close">×</button>
          </div>
          <form id="login-form" class="auth-forms auth-forms-vertical">
            <label class="auth-field">
              <span class="auth-label">Email / Username</span>
              <input name="email" type="text" placeholder="you@example.com or your username" required />
            </label>
            <label class="auth-field">
              <span class="auth-label">Password</span>
              <input name="password" type="password" placeholder="••••••••" required />
            </label>
            <button
              type="button"
              id="forgot-password-btn"
              class="link-btn"
              style="margin-top:0.2rem;"
            >
              Forgot Password?
            </button>
            <button class="btn" type="submit" style="width:100%;margin-top:0.6rem;">Sign In</button>
          </form>
          <div id="auth-error" class="error"></div>
          <div class="auth-modal-footer">
            Don’t have an account?
            <button type="button" id="auth-modal-switch-to-signup" class="link-btn" style="margin-left:0.15rem;">
              Register an Account
            </button>
          </div>
        </div>
      </div>
    `;

    const overlay = document.getElementById("auth-modal-overlay");
    const closeBtn = document.getElementById("auth-modal-close");
    const loginForm = document.getElementById("login-form");
    const forgotBtn = document.getElementById("forgot-password-btn");
    const switchToSignup = document.getElementById("auth-modal-switch-to-signup");

    if (overlay) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeAuthModal();
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", () => closeAuthModal());
    }
    if (loginForm) {
      loginForm.addEventListener("submit", handleLogin);
    }
    if (forgotBtn && loginForm) {
      forgotBtn.addEventListener("click", async () => {
        if (!supabaseClient) return;
        const errorEl = document.getElementById("auth-error");
        if (!errorEl) return;

        const emailInput = loginForm.querySelector('input[name="email"]');
        const email = emailInput && emailInput.value ? emailInput.value.trim() : "";

        if (!email) {
          errorEl.textContent = "Enter your email above first, then click Forgot Password.";
          return;
        }

        try {
          errorEl.textContent = "";
          const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
          if (error) throw error;
          errorEl.textContent = "If that email exists, a reset link has been sent.";
        } catch (err) {
          console.error(err);
          errorEl.textContent = err.message || "Failed to start password reset.";
        }
      });
    }
    if (switchToSignup) {
      switchToSignup.addEventListener("click", () => {
        openAuthModal("signup");
      });
    }
  } else {
    authModalRoot.innerHTML = `
      <div class="auth-modal-overlay" id="auth-modal-overlay">
        <div class="auth-modal">
          <div class="auth-modal-header">
            <div class="auth-modal-title">Create an Account</div>
            <button class="auth-modal-close" id="auth-modal-close">×</button>
          </div>
          <form id="signup-form" class="auth-forms auth-forms-vertical">
            <label class="auth-field">
              <span class="auth-label">Email</span>
              <input name="email" type="email" placeholder="you@example.com" required />
            </label>
            <label class="auth-field">
              <span class="auth-label">Username</span>
              <input name="username" type="text" placeholder="Pick something unique" required />
            </label>
            <label class="auth-field">
              <span class="auth-label">Password</span>
              <input name="password" type="password" placeholder="••••••••" required />
            </label>
            <button class="btn" type="submit" style="width:100%;margin-top:0.6rem;">Register</button>
          </form>
          <div id="auth-error" class="error"></div>
          <div class="auth-modal-footer">
            Already have an account?
            <button type="button" id="auth-modal-switch-to-login" class="link-btn" style="margin-left:0.15rem;">
              Sign in
            </button>
          </div>
        </div>
      </div>
    `;

    const overlay = document.getElementById("auth-modal-overlay");
    const closeBtn = document.getElementById("auth-modal-close");
    const signupForm = document.getElementById("signup-form");
    const switchToLogin = document.getElementById("auth-modal-switch-to-login");

    if (overlay) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeAuthModal();
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", () => closeAuthModal());
    }
    if (signupForm) {
      signupForm.addEventListener("submit", handleSignup);
    }
    if (switchToLogin) {
      switchToLogin.addEventListener("click", () => {
        openAuthModal("login");
      });
    }
  }
}

function closeAuthModal() {
  if (authModalRoot) {
    authModalRoot.innerHTML = "";
  }
}

// --- State ---
let currentUser = null;
let currentView = "hub"; // "hub" | "game"
let currentGameId = null;
let currentAuthMode = "login"; // "login" | "signup"
let operatorMatchesFilter = "all"; // kept for potential future use
let wagersFilter = "all"; // "all" | "wins" | "losses" | "today"

// Free Spin Wheel (replaces the old daily coin bonus).
// NOTE: reuses the existing `last_daily_at` profiles column to track the last
// spin claim time so no database migration is required. Cash winnings are
// paid directly into cash_balance the instant a spin resolves.
const SPIN_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours between free spins
// Ordered highest-amount/lowest-count first so the even-distribution
// placement algorithm spreads rare, valuable slices around the wheel first.
const SPIN_WHEEL_PRIZE_GROUPS = [
  { amount: 0.50, count: 1, color: "#facc15", textColor: "#3a2400", label: "50¢", jackpot: true },
  { amount: 0.40, count: 2, color: "#fb923c", textColor: "#3a1600", label: "40¢" },
  { amount: 0.30, count: 3, color: "#34d399", textColor: "#022c22", label: "30¢" },
  { amount: 0.25, count: 4, color: "#818cf8", textColor: "#1e1b4b", label: "25¢" },
  { amount: 0.10, count: 5, color: "#38bdf8", textColor: "#082f49", label: "10¢" },
  { amount: 0.05, count: 10, color: "#94a3b8", textColor: "#1e293b", label: "5¢" },
];
let spinWheelRotation = 0; // cumulative rotation (deg), persists across modal opens
let spinInProgress = false;

const WAGER_AMOUNTS = [50, 100, 500, 1000];
let currentWagerIndex = 1; // start at 100 coins
const WAGER_COOLDOWN_MS = 10_000; // 10 seconds between wagers per game
const lastWagerAtByGame = {}; // { [gameId]: timestamp }
const MATCH_TIMEOUT_MS = 3 * 24 * 60 * 60 * 1000; // 3 days before treating unmatched score as a tie/refund (TODO: add admin-dashboard "request refund" option for pending matches)

// Cash tournament entry amounts (real money)
const CASH_ENTRY_AMOUNTS = [0.5, 1, 2, 5, 10, 20];
let currentCashEntryIndex = 1; // start at $1
let flappyWagerMode = "cash"; // "coin" or "cash" (coin wagers hidden for now)

const ADMIN_USERNAMES = ["zoominz9"]; // usernames allowed to see admin-only views

function getCurrentWagerAmount() {
  return WAGER_AMOUNTS[currentWagerIndex] || WAGER_AMOUNTS[0];
}

function cycleWagerAmount() {
  currentWagerIndex = (currentWagerIndex + 1) % WAGER_AMOUNTS.length;
  updateWagerButtons();
}

function setWagerIndex(nextIndex) {
  const clamped = Math.max(0, Math.min(WAGER_AMOUNTS.length - 1, nextIndex));
  currentWagerIndex = clamped;
  updateWagerButtons();
}

function increaseWagerAmount() {
  setWagerIndex(currentWagerIndex + 1);
}

function decreaseWagerAmount() {
  setWagerIndex(currentWagerIndex - 1);
}

// Cash entry helpers
function getCurrentCashEntry() {
  return CASH_ENTRY_AMOUNTS[currentCashEntryIndex] || CASH_ENTRY_AMOUNTS[0];
}

function setCashEntryIndex(nextIndex) {
  const clamped = Math.max(0, Math.min(CASH_ENTRY_AMOUNTS.length - 1, nextIndex));
  currentCashEntryIndex = clamped;
  updateFlappyCashUI();
  if (typeof updateGermsCashUI === "function") updateGermsCashUI();
  if (typeof updateChickenCashUI === "function") updateChickenCashUI();
  if (typeof updateReactionCashUI === "function") updateReactionCashUI();
  if (typeof updateStackCashUI === "function") updateStackCashUI();
  if (typeof updateNightShiftCashUI === "function") updateNightShiftCashUI();
  if (typeof updateRollingRushCashUI === "function") updateRollingRushCashUI();
}

function increaseCashEntry() {
  setCashEntryIndex(currentCashEntryIndex + 1);
}

function decreaseCashEntry() {
  setCashEntryIndex(currentCashEntryIndex - 1);
}

function getFlappyPlayerCount() {
  const playersSelect = document.getElementById("flappy-players");
  return playersSelect ? parseInt(playersSelect.value) : 2;
}

function updateFlappyCashUI() {
  const entry = getCurrentCashEntry();
  const playerCount = getFlappyPlayerCount();
  const total = entry * playerCount;
  const fee = total * 0.15;
  const payout = total - fee;

  const cashLabel = document.getElementById("flappy-cash-label");
  if (cashLabel) {
    cashLabel.textContent = `Entry: $${entry.toFixed(2)}`;
  }
  const cashPayout = document.getElementById("flappy-cash-payout");
  if (cashPayout) {
    cashPayout.textContent = `Win: $${payout.toFixed(2)}`;
  }
  const cashUp = document.getElementById("flappy-cash-up");
  const cashDown = document.getElementById("flappy-cash-down");
  if (cashUp) cashUp.disabled = currentCashEntryIndex >= CASH_ENTRY_AMOUNTS.length - 1;
  if (cashDown) cashDown.disabled = currentCashEntryIndex <= 0;
}

function setFlappyWagerMode(mode) {
  flappyWagerMode = mode;
  const coinControls = document.getElementById("flappy-coin-controls");
  const cashControls = document.getElementById("flappy-cash-controls");
  const coinToggle = document.getElementById("flappy-mode-coin");
  const cashToggle = document.getElementById("flappy-mode-cash");

  if (mode === "cash") {
    if (coinControls) coinControls.style.display = "none";
    if (cashControls) cashControls.style.display = "";
    if (coinToggle) coinToggle.classList.remove("active");
    if (cashToggle) cashToggle.classList.add("active");
    updateFlappyCashUI();
  } else {
    if (coinControls) coinControls.style.display = "";
    if (cashControls) cashControls.style.display = "none";
    if (coinToggle) coinToggle.classList.add("active");
    if (cashToggle) cashToggle.classList.remove("active");
    updateWagerButtons();
  }
}

function updateWagerButtons() {
  const amount = getCurrentWagerAmount();
  const flappyPlayerCount = getFlappyPlayerCount();
  const flappyTotal = amount * flappyPlayerCount;
  const flappyFee = Math.round(flappyTotal * 0.15);
  const flappyPrize = flappyTotal - flappyFee;
  
  // Default 2-player calc for other games
  const total = amount * 2;
  const fee = Math.round(total * 0.15);
  const payout = total - fee;

  const flappyBtn = document.getElementById("flappy-wager");
  if (flappyBtn) {
    flappyBtn.textContent = "Start Tournament";
  }
  const flappyBetLabel = document.getElementById("flappy-bet-label");
  if (flappyBetLabel) {
    flappyBetLabel.textContent = `Entry fee: ${amount}`;
  }
  const flappyPayoutEl = document.getElementById("flappy-payout");
  if (flappyPayoutEl) {
    flappyPayoutEl.textContent = `Win - ${flappyPrize}`;
  }
  const flappyUp = document.getElementById("flappy-bet-up");
  const flappyDown = document.getElementById("flappy-bet-down");
  if (flappyUp) flappyUp.disabled = currentWagerIndex >= WAGER_AMOUNTS.length - 1;
  if (flappyDown) flappyDown.disabled = currentWagerIndex <= 0;

  const stackBtn = document.getElementById("stack-wager");
  if (stackBtn) {
    stackBtn.textContent = "Start Tournament";
  }
  const stackBetLabel = document.getElementById("stack-bet-label");
  if (stackBetLabel) {
    stackBetLabel.textContent = `Entry fee: ${amount}`;
  }
  const stackPayout = document.getElementById("stack-payout");
  if (stackPayout) {
    stackPayout.textContent = `Win - ${payout}`;
  }
  const stackUp = document.getElementById("stack-bet-up");
  const stackDown = document.getElementById("stack-bet-down");
  if (stackUp) stackUp.disabled = currentWagerIndex >= WAGER_AMOUNTS.length - 1;
  if (stackDown) stackDown.disabled = currentWagerIndex <= 0;

  const reactionBtn = document.getElementById("reaction-wager");
  if (reactionBtn) {
    reactionBtn.textContent = "Start Tournament";
  }
  const reactionBetLabel = document.getElementById("reaction-bet-label");
  if (reactionBetLabel) {
    reactionBetLabel.textContent = `Entry fee: ${amount}`;
  }
  const reactionPayout = document.getElementById("reaction-payout");
  if (reactionPayout) {
    reactionPayout.textContent = `Win - ${payout}`;
  }
  const reactionUp = document.getElementById("reaction-bet-up");
  const reactionDown = document.getElementById("reaction-bet-down");
  if (reactionUp) reactionUp.disabled = currentWagerIndex >= WAGER_AMOUNTS.length - 1;
  if (reactionDown) reactionDown.disabled = currentWagerIndex <= 0;

  const chickenBtn = document.getElementById("chicken-wager");
  if (chickenBtn) {
    chickenBtn.textContent = "Start Tournament";
  }
  const chickenBetLabel = document.getElementById("chicken-bet-label");
  if (chickenBetLabel) {
    chickenBetLabel.textContent = `Entry fee: ${amount}`;
  }
  const chickenPayout = document.getElementById("chicken-payout");
  if (chickenPayout) {
    chickenPayout.textContent = `Win - ${payout}`;
  }
  const chickenUp = document.getElementById("chicken-bet-up");
  const chickenDown = document.getElementById("chicken-bet-down");
  if (chickenUp) chickenUp.disabled = currentWagerIndex >= WAGER_AMOUNTS.length - 1;
  if (chickenDown) chickenDown.disabled = currentWagerIndex <= 0;

  const germsBtn = document.getElementById("germs-wager");
  if (germsBtn) {
    germsBtn.textContent = "Start Tournament";
  }
  const germsBetLabel = document.getElementById("germs-bet-label");
  if (germsBetLabel) {
    germsBetLabel.textContent = `Entry fee: ${amount}`;
  }
  const germsPayout = document.getElementById("germs-payout");
  if (germsPayout) {
    germsPayout.textContent = `Win - ${payout}`;
  }
  const germsUp = document.getElementById("germs-bet-up");
  const germsDown = document.getElementById("germs-bet-down");
  if (germsUp) germsUp.disabled = currentWagerIndex >= WAGER_AMOUNTS.length - 1;
  if (germsDown) germsDown.disabled = currentWagerIndex <= 0;
}

function updateGermsCashUI() {
  const entry = getCurrentCashEntry();
  const total = entry * 2;
  const fee = total * 0.15;
  const payout = total - fee;

  const cashLabel = document.getElementById("germs-cash-label");
  if (cashLabel) {
    cashLabel.textContent = `Entry: $${entry.toFixed(2)}`;
  }
  const cashPayout = document.getElementById("germs-cash-payout");
  if (cashPayout) {
    cashPayout.textContent = `Win: $${payout.toFixed(2)}`;
  }
  const cashUp = document.getElementById("germs-cash-up");
  const cashDown = document.getElementById("germs-cash-down");
  if (cashUp) cashUp.disabled = currentCashEntryIndex >= CASH_ENTRY_AMOUNTS.length - 1;
  if (cashDown) cashDown.disabled = currentCashEntryIndex <= 0;
}

function updateChickenCashUI() {
  const entry = getCurrentCashEntry();
  const total = entry * 2;
  const fee = total * 0.15;
  const payout = total - fee;

  const cashLabel = document.getElementById("chicken-cash-label");
  if (cashLabel) {
    cashLabel.textContent = `Entry: $${entry.toFixed(2)}`;
  }
  const cashPayout = document.getElementById("chicken-cash-payout");
  if (cashPayout) {
    cashPayout.textContent = `Win: $${payout.toFixed(2)}`;
  }
  const cashUp = document.getElementById("chicken-cash-up");
  const cashDown = document.getElementById("chicken-cash-down");
  if (cashUp) cashUp.disabled = currentCashEntryIndex >= CASH_ENTRY_AMOUNTS.length - 1;
  if (cashDown) cashDown.disabled = currentCashEntryIndex <= 0;
}

function updateReactionCashUI() {
  const entry = getCurrentCashEntry();
  const total = entry * 2;
  const fee = total * 0.15;
  const payout = total - fee;

  const cashLabel = document.getElementById("reaction-cash-label");
  if (cashLabel) {
    cashLabel.textContent = `Entry: $${entry.toFixed(2)}`;
  }
  const cashPayout = document.getElementById("reaction-cash-payout");
  if (cashPayout) {
    cashPayout.textContent = `Win: $${payout.toFixed(2)}`;
  }
  const cashUp = document.getElementById("reaction-cash-up");
  const cashDown = document.getElementById("reaction-cash-down");
  if (cashUp) cashUp.disabled = currentCashEntryIndex >= CASH_ENTRY_AMOUNTS.length - 1;
  if (cashDown) cashDown.disabled = currentCashEntryIndex <= 0;
}

function updateStackCashUI() {
  const entry = getCurrentCashEntry();
  const total = entry * 2;
  const fee = total * 0.15;
  const payout = total - fee;

  const cashLabel = document.getElementById("stack-cash-label");
  if (cashLabel) {
    cashLabel.textContent = `Entry: $${entry.toFixed(2)}`;
  }
  const cashPayout = document.getElementById("stack-cash-payout");
  if (cashPayout) {
    cashPayout.textContent = `Win: $${payout.toFixed(2)}`;
  }
  const cashUp = document.getElementById("stack-cash-up");
  const cashDown = document.getElementById("stack-cash-down");
  if (cashUp) cashUp.disabled = currentCashEntryIndex >= CASH_ENTRY_AMOUNTS.length - 1;
  if (cashDown) cashDown.disabled = currentCashEntryIndex <= 0;
}

function setGermsWagerMode(mode) {
  germsWagerMode = mode;
  const coinControls = document.getElementById("germs-coin-controls");
  const cashControls = document.getElementById("germs-cash-controls");
  const coinToggle = document.getElementById("germs-mode-coin");
  const cashToggle = document.getElementById("germs-mode-cash");

  if (mode === "cash") {
    if (coinControls) coinControls.style.display = "none";
    if (cashControls) cashControls.style.display = "";
    if (coinToggle) coinToggle.classList.remove("active");
    if (cashToggle) cashToggle.classList.add("active");
    updateGermsCashUI();
  } else {
    if (coinControls) coinControls.style.display = "";
    if (cashControls) cashControls.style.display = "none";
    if (coinToggle) coinToggle.classList.add("active");
    if (cashToggle) cashToggle.classList.remove("active");
    updateWagerButtons();
  }
}

function isAdmin() {
  return !!(
    currentUser &&
    currentUser.username &&
    ADMIN_USERNAMES.includes(currentUser.username)
  );
}

// When a user joins an existing Flappy wager from history, we stash
// the match to attach wager state after Flappy mounts.
let pendingFlappyJoin = null; // { matchId, slot }
// Same pattern for Stack Duel wagers (from auto-join/create or history later).
let pendingStackJoin = null; // { matchId, slot }
// Same pattern for Chicken Run wagers.
let pendingChickenJoin = null; // { matchId, slot }
// Same pattern for Avoid the Germs wagers.
let pendingGermsJoin = null; // { matchId, slot, isCashMode, cashEntry }

// --- DOM refs ---
const authSection = document.getElementById("auth-section");
const mainContent = document.getElementById("main-content");
const authModalRoot = document.getElementById("auth-modal-root");

function render() {
  renderAuth();
  renderMain();
}

// Update just the balance display without full re-render
function updateBalanceDisplay() {
  if (!currentUser) return;
  
  console.log('[UI] Updating balance display - cash:', currentUser.cash_balance);
  
  // Update header cash balance by ID  
  const cashBalanceHeaderEl = document.getElementById('cash-balance-header');
  if (cashBalanceHeaderEl) {
    cashBalanceHeaderEl.textContent = `$${(currentUser.cash_balance || 0).toFixed(2)}`;
  }
  
  // Update profile cash balance if visible
  const cashBalanceEl = document.getElementById('cash-balance');
  if (cashBalanceEl) {
    cashBalanceEl.textContent = `${(currentUser.cash_balance || 0).toFixed(2)}`;
  }
  
  // Update dash cash balance display if visible
  const dashCashBalance = document.getElementById('dash-cash-balance');
  if (dashCashBalance) {
    dashCashBalance.textContent = `Balance: $${(currentUser.cash_balance || 0).toFixed(2)}`;
  }
}

function renderAuth() {
  if (!supabaseClient) {
    authSection.innerHTML = ``;
    return;
  }

  if (!currentUser) {
    authSection.innerHTML = `
      <div class="header-auth-buttons">
        <button id="header-login-btn" class="btn btn-secondary">Login</button>
        <button id="header-register-btn" class="btn">Register</button>
      </div>
    `;

    const loginBtn = document.getElementById("header-login-btn");
    const registerBtn = document.getElementById("header-register-btn");
    if (loginBtn) {
      loginBtn.addEventListener("click", () => {
        openAuthModal("login");
      });
    }
    if (registerBtn) {
      registerBtn.addEventListener("click", () => {
        openAuthModal("signup");
      });
    }
  } else {
    const spinInfo = getSpinInfo(currentUser);

    authSection.innerHTML = `
      <div class="card auth-logged-in">
        <div class="auth-user-row">
          <div class="auth-user-meta" style="display:flex;align-items:center;gap:0.5rem;">
            <div class="auth-username">@${currentUser.username}</div>
            ${
              isAdmin()
                ? `<a href="admin.html" class="btn btn-secondary" style="padding:0.15rem 0.6rem;font-size:0.7rem;text-decoration:none;background:#dc2626;">🛡️ Admin Panel</a>`
                : ""
            }
          </div>
          <div class="balance-display">
            <div class="balance-amount">
              <span id="cash-balance-header">$${Number(currentUser.cash_balance ?? 0).toFixed(2)}</span>
              <button id="header-deposit-btn" class="btn btn-secondary" style="margin-left:0.4rem;padding:0.1rem 0.55rem;font-size:0.7rem;line-height:1;">Deposit</button>
              <button id="balance-refresh-btn" class="btn btn-secondary" style="margin-left:0.35rem;padding:0.1rem 0.4rem;font-size:0.7rem;line-height:1;">↻</button>
            </div>
          </div>
        </div>

        <div
          class="small-text"
          style="margin-top:0.6rem;margin-bottom:0.4rem;padding:0.4rem 0.6rem;border-radius:999px;background:linear-gradient(90deg, rgba(250,204,21,0.12), rgba(251,146,60,0.12));border:1px solid rgba(250,204,21,0.4);display:flex;flex-wrap:wrap;gap:0.6rem;align-items:center;justify-content:space-between;"
        >
          <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;">
            <span style="font-weight:600;">🎡 Free spin: win up to $0.50</span>
            <span style="opacity:0.9;">
              ${spinInfo.ready ? "Ready to spin now" : `Next spin in ${spinInfo.formattedRemaining}`}
            </span>
          </div>
          <button
            id="spin-wheel-btn"
            class="btn btn-secondary"
            ${spinInfo.ready ? "" : "disabled"}
            style="padding:0.25rem 0.75rem;font-size:0.75rem;white-space:nowrap;"
          >
            Spin the wheel
          </button>
        </div>
        <div class="auth-actions-row">
          <button id="profile-btn" class="btn btn-secondary">Profile</button>
          <button id="logout-btn" class="btn btn-secondary" style="margin-left:auto;">Log out</button>
        </div>
      </div>
    `;

    const profileBtn = document.getElementById("profile-btn");
    if (profileBtn) {
      profileBtn.addEventListener("click", () => {
        currentView = "profile";
        render();
      });
    }

    const balanceRefreshBtn = document.getElementById("balance-refresh-btn");
    if (balanceRefreshBtn) {
      balanceRefreshBtn.addEventListener("click", () => {
        if (!supabaseClient || !currentUser) return;
        loadCurrentUser().catch((err) => console.error("Failed to refresh balance", err));
      });
    }

    const headerDepositBtn = document.getElementById("header-deposit-btn");
    if (headerDepositBtn) {
      headerDepositBtn.addEventListener("click", () => {
        openDepositModal();
      });
    }

    document.getElementById("logout-btn").addEventListener("click", handleLogout);
    const spinWheelBtn = document.getElementById("spin-wheel-btn");
    if (spinWheelBtn) {
      spinWheelBtn.addEventListener("click", openSpinWheelModal);
    }

    const balancePill = authSection.querySelector(".balance-amount");
    if (balancePill) {
      balancePill.classList.remove("flash");
      // Force reflow so the animation can restart if it was already applied previously.
      // eslint-disable-next-line no void
      void balancePill.offsetWidth;
      balancePill.classList.add("flash");
    }
  }
}

function renderMain() {
  if (currentView === "hub") {
    renderHub();
  } else if (currentView === "game") {
    renderGameScreen();
  } else if (currentView === "profile") {
    renderProfileScreen();
  }
}

function renderProfileScreen() {
  if (!currentUser) {
    currentView = "hub";
    render();
    return;
  }

  mainContent.innerHTML = `
    <section class="card" style="margin-bottom:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
        <div>
          <h2 class="section-title">Profile</h2>
          <p class="small-text">Account details and basic activity for @${currentUser.username}.</p>
        </div>
        <button id="back-to-hub-from-profile" class="btn btn-secondary">Back to games</button>
      </div>
    </section>

    <section class="card" style="margin-bottom:1rem;">
      <h3 class="section-title">Account info</h3>
      <div class="small-text" style="margin-top:0.5rem;">
        <strong>Username:</strong> @${currentUser.username}
      </div>
      <div class="small-text" style="margin-top:0.25rem;">
        <strong>Email:</strong> ${currentUser.email || "(not set)"}
      </div>
      <div class="small-text" style="margin-top:0.25rem;">
        <strong>Cash balance:</strong> $<span id="cash-balance">${Number(currentUser.cash_balance ?? 0).toFixed(2)}</span>
        <button id="cash-deposit-btn" class="btn btn-secondary" style="margin-left:0.5rem;padding:0.15rem 0.5rem;font-size:0.75rem;">Deposit</button>
      </div>
      <div class="small-text" style="margin-top:0.25rem;">
        <strong>KYC status:</strong> ${currentUser.kyc_status || "unverified"}
      </div>
      <div class="small-text" style="margin-top:0.25rem;">
        <strong>Free spin status:</strong> ${getSpinInfo(currentUser).ready ? "Ready now" : `Next in ${getSpinInfo(currentUser).formattedRemaining}`}
      </div>
    </section>

    <section class="card" style="margin-bottom:0.75rem;">
      <div style="display:flex;flex-wrap:wrap;gap:1.25rem;align-items:flex-start;">
        <div style="flex:1 1 260px;min-width:0;padding-right:0.75rem;border-right:1px solid rgba(148,163,184,0.22);">
          <div class="small-text" style="text-transform:uppercase;letter-spacing:0.08em;font-size:0.7rem;color:#9ca3af;margin-bottom:0.15rem;">Email</div>
          <h3 class="section-title" style="margin-bottom:0.1rem;">Change email</h3>
          <form id="change-email-form" class="auth-forms auth-forms-vertical" style="margin-top:0.3rem;">
            <label class="auth-field">
              <span class="auth-label">Current password</span>
              <input name="current_password" type="password" placeholder="••••••••" required />
            </label>
            <label class="auth-field">
              <span class="auth-label">New email</span>
              <input name="new_email" type="email" placeholder="you@example.com" required />
            </label>
            <button class="btn" type="submit" style="margin-top:0.4rem;">Update email</button>
          </form>
          <div id="change-email-status" class="small-text" style="margin-top:0.35rem; min-height:1em;"></div>
        </div>

        <div style="flex:1 1 260px;min-width:0;padding-left:0.75rem;">
          <div class="small-text" style="text-transform:uppercase;letter-spacing:0.08em;font-size:0.7rem;color:#9ca3af;margin-bottom:0.15rem;">Password</div>
          <h3 class="section-title" style="margin-bottom:0.1rem;">Change password</h3>
          <form id="change-password-form" class="auth-forms auth-forms-vertical" style="margin-top:0.3rem;">
            <label class="auth-field">
              <span class="auth-label">Current password</span>
              <input name="current_password" type="password" placeholder="••••••••" required />
            </label>
            <label class="auth-field">
              <span class="auth-label">New password</span>
              <input name="new_password" type="password" placeholder="••••••••" required />
            </label>
            <label class="auth-field">
              <span class="auth-label">Confirm new password</span>
              <input name="confirm_password" type="password" placeholder="••••••••" required />
            </label>
            <button class="btn" type="submit" style="margin-top:0.4rem;">Update password</button>
          </form>
          <div id="change-password-status" class="small-text" style="margin-top:0.35rem; min-height:1em;"></div>
        </div>
      </div>
    </section>

    <section class="card" style="margin-bottom:1rem;">
      <h3 class="section-title">Cash activity</h3>
      <p class="small-text" style="margin-top:0.5rem;">Recent deposits and withdrawals for this account.</p>
      <div id="cash-activity" class="small-text" style="margin-top:0.5rem; min-height:1.5em;">Loading recent activity...</div>
    </section>

    <section class="card" style="margin-bottom:1rem;">
      <h3 class="section-title">Withdraw Cash to Bitcoin</h3>
      <p class="small-text" style="margin-top:0.5rem;">Minimum withdrawal is $5. Cashouts require KYC approval and pay a Lightning Network invoice from your wallet.</p>
      <form id="cash-withdrawal-form" class="auth-forms auth-forms-vertical" style="margin-top:0.35rem;max-width:320px;">
        <label class="auth-field">
          <span class="auth-label">Amount (Cash)</span>
          <input name="amount_cash" type="number" min="5" step="0.01" placeholder="5.00" required />
        </label>
        <label class="auth-field">
          <span class="auth-label">Lightning invoice (BOLT11)</span>
          <input name="lightning_invoice" type="text" placeholder="lnbc1..." required />
        </label>
        <button id="cash-withdraw-btn" class="btn" type="submit" style="margin-top:0.4rem;">Withdraw to Bitcoin</button>
      </form>
      <div id="cash-withdrawal-status" class="small-text" style="margin-top:0.35rem; min-height:1em;"></div>
      <div id="cash-deposit-status" class="small-text" style="margin-top:0.25rem; min-height:1em;"></div>
    </section>

    <section class="card">
      <h3 class="section-title">Wager activity</h3>
      <p class="small-text" style="margin-top:0.5rem;">Use the "+ Wagered games" panel on the home screen to see your recent wagers. A richer breakdown will be added to this profile page later.</p>
    </section>
  `;

  const backBtn = document.getElementById("back-to-hub-from-profile");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      currentView = "hub";
      render();
    });
  }

  const changeEmailForm = document.getElementById("change-email-form");
  if (changeEmailForm) {
    changeEmailForm.addEventListener("submit", handleChangeEmailSubmit);
  }

  const changePasswordForm = document.getElementById("change-password-form");
  if (changePasswordForm) {
    changePasswordForm.addEventListener("submit", handleChangePasswordSubmit);
  }

  const cashDepositBtn = document.getElementById("cash-deposit-btn");
  if (cashDepositBtn) {
    cashDepositBtn.addEventListener("click", () => {
      openDepositModal();
    });
  }

  const withdrawForm = document.getElementById("cash-withdrawal-form");
  if (withdrawForm) {
    withdrawForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const statusEl = document.getElementById("cash-withdrawal-status");
      const withdrawBtn = document.getElementById("cash-withdraw-btn");
      if (statusEl) statusEl.textContent = "Submitting withdrawal...";
      if (withdrawBtn) withdrawBtn.disabled = true;

      const form = event.target;
      const amountInput = form.amount_cash;
      const invoiceInput = form.lightning_invoice;
      const amountCash = Number(amountInput.value);
      const lightningInvoice = invoiceInput.value.trim();

      startBitcoinWithdrawal(amountCash, lightningInvoice)
        .then((ok) => {
          if (!statusEl) return;
          if (ok) {
            statusEl.textContent = "Withdrawal requested. Your Cash balance has been updated.";
            form.reset();
          } else {
            statusEl.textContent = "Withdrawal failed. Check amount, address, and KYC status.";
          }
        })
        .catch((err) => {
          console.error("Failed to request withdrawal", err);
          if (statusEl) statusEl.textContent = "Withdrawal failed. Please try again.";
        })
        .finally(() => {
          if (withdrawBtn) withdrawBtn.disabled = false;
        });
    });
  }

  const activityEl = document.getElementById("cash-activity");
  if (activityEl && supabaseClient && currentUser) {
    loadCashActivity().catch((err) => {
      console.error("Failed to load cash activity", err);
      activityEl.textContent = "Could not load recent activity.";
    });
  }
}

async function startBitcoinDeposit(amountCash = 5) {
  if (!supabaseClient) return false;

  const {
    data: { session },
    error: sessionError,
  } = await supabaseClient.auth.getSession();

  if (sessionError || !session || !session.access_token) {
    console.error("No auth session found for deposit", sessionError);
    return false;
  }

  try {
    const res = await fetch(
      "https://chyhilxjcjjzeragkkoq.functions.supabase.co/create-btc-checkout",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ amountCash }),
      }
    );

    if (!res.ok) {
      console.error("create-btc-checkout failed", res.status, await res.text());
      return false;
    }

    const { hostedUrl } = await res.json();

    if (!hostedUrl) {
      return false;
    }

    window.open(hostedUrl, "_blank", "noopener,noreferrer");
    return true;
  } catch (err) {
    console.error("Error calling create-btc-checkout", err);
    return false;
  }
}

async function startBitcoinWithdrawal(amountCash, btcAddress) {
  if (!supabaseClient) return false;

  const {
    data: { session },
    error: sessionError,
  } = await supabaseClient.auth.getSession();

  if (sessionError || !session || !session.access_token) {
    console.error("No auth session found for withdrawal", sessionError);
    return false;
  }

  try {
    const res = await fetch(
      "https://chyhilxjcjjzeragkkoq.functions.supabase.co/create-btc-withdrawal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ amountCash, lightningInvoice: btcAddress }),
      }
    );

    if (!res.ok) {
      console.error("create-btc-withdrawal failed", res.status, await res.text());
      return false;
    }

    await loadCurrentUser();
    return true;
  } catch (err) {
    console.error("Error calling create-btc-withdrawal", err);
    return false;
  }
}

async function loadCashActivity() {
  if (!supabaseClient || !currentUser) return;
  const activityEl = document.getElementById("cash-activity");
  if (!activityEl) return;

  const [{ data: deposits, error: depError }, { data: withdrawals, error: wdError }] = await Promise.all([
    supabaseClient
      .from("deposits")
      .select("id, cash_amount, created_at, status")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabaseClient
      .from("withdrawals")
      .select("id, amount_cash, created_at, status")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (depError || wdError) {
    console.error("Error loading cash activity", depError, wdError);
    activityEl.textContent = "Could not load recent activity.";
    return;
  }

  const depositEvents = (deposits || []).map((d) => ({
    amount: Number(d.cash_amount ?? 0),
    created_at: d.created_at,
    status: d.status,
  }));

  const withdrawalEvents = (withdrawals || []).map((w) => ({
    amount: Number(w.amount_cash ?? 0),
    created_at: w.created_at,
    status: w.status,
  }));

  if (!depositEvents.length && !withdrawalEvents.length) {
    activityEl.textContent = "No cash deposits or withdrawals yet.";
    return;
  }

  const formatList = (items, label) => {
    if (!items.length) {
      return `<div class="small-text" style="margin-bottom:0.25rem;">No ${label.toLowerCase()} yet.</div>`;
    }
    const sorted = [...items].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const top = sorted.slice(0, 5);
    return top
      .map((e) => {
        const date = new Date(e.created_at);
        const formattedDate = isNaN(date.getTime()) ? "" : date.toLocaleString();
        return `<div style="margin-bottom:0.25rem;">${label} $${e.amount.toFixed(2)} – ${
          e.status || "pending"
        }${formattedDate ? ` · ${formattedDate}` : ""}</div>`;
      })
      .join("");
  };

  activityEl.innerHTML = `
    <div style="margin-bottom:0.35rem;"><strong>Deposits</strong></div>
    ${formatList(depositEvents, "Deposit")}
    <div style="margin-top:0.5rem;margin-bottom:0.35rem;"><strong>Withdrawals</strong></div>
    ${formatList(withdrawalEvents, "Withdrawal")}
  `;
}

const gameCards = [
  {
    id: "flappy-race",
    title: "Flappy Race",
    description: "Side-scrolling skill race. Highest score wins.",
    mode: "1v1 skill",
    comingSoon: false,
  },
  {
    id: "stack-duel",
    title: "Stack Duel",
    description: "Time your drops to build the tallest tower.",
    mode: "1v1 skill",
    comingSoon: false,
  },
  {
    id: "chicken-run",
    title: "Chicken Run",
    description: "Dodge obstacles and survive longer than your opponent.",
    mode: "1v1 skill",
    comingSoon: false,
  },
  {
    id: "reaction-duel",
    title: "Reaction Duel",
    description: "Wait for the signal, then click faster than your rival.",
    mode: "1v1 skill",
    comingSoon: false,
  },
  {
    id: "speed-dash",
    title: "Speed Dash",
    description: "Click fast to sprint! Race against others in real-time.",
    mode: "Live multiplayer",
    comingSoon: false,
  },
  {
    id: "avoid-germs",
    title: "Avoid the Germs",
    description: "Dodge chasing germs and collect rings to beat your high score.",
    mode: "1v1 skill",
    comingSoon: false,
  },
  {
    id: "night-shift",
    title: "Night Shift",
    description: "First-person zombie survival. Endless escalating waves — no one finishes, highest wave/kills wins.",
    mode: "1v1 skill",
    comingSoon: false,
  },
  {
    id: "rolling-rush",
    title: "Rolling Rush",
    description: "Endless 3-lane dodge run. Weave and jump past obstacles — the run never ends, highest score wins.",
    mode: "1v1 skill",
    comingSoon: false,
  },
];

function renderHub() {
  mainContent.innerHTML = `
    <section class="card" style="margin-bottom:1rem;">
      <div class="badge" style="margin-bottom:0.5rem;">Early prototype</div>
      <h2 class="section-title">Skill Arcade</h2>
      <p class="tagline">Play local prototypes of skill games. Logins and coins are optional while we build the core games.</p>
    </section>

    <section class="card">
      <h3 class="section-title">Games</h3>
      <div class="grid" style="margin-top:0.75rem;">
        ${gameCards
          .map(
            (g) => `
          <article class="card game-card">
            ${
              g.id === "flappy-race"
                ? `<div class="game-card-media"><img src="assets/flappy-race-cover.jpg" alt="Flappy Race cover" class="game-card-image" /></div>`
                : ""
            }
            <div class="game-title">${g.title}</div>
            <div class="game-meta">${g.description}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.75rem;">
              <span class="pill">${g.mode}</span>
              <button class="btn btn-secondary" data-game-id="${g.id}">${
                g.comingSoon ? "Coming soon" : "Play"
              }</button>
            </div>
          </article>
        `
          )
          .join("")}
      </div>
    </section>

    <section class="card" style="margin-top:1rem;" id="wagers-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
        <h3 class="section-title" style="margin-bottom:0;">Tournament Results</h3>
        <div style="display:flex;align-items:center;gap:0.4rem;">
          <div class="wagers-filter-group" style="display:flex;gap:0.35rem;font-size:0.75rem;">
            <button id="wagers-filter-all" class="btn btn-secondary" style="padding:0.2rem 0.7rem;">All</button>
            <button id="wagers-filter-wins" class="btn btn-secondary" style="padding:0.2rem 0.7rem;">Wins</button>
            <button id="wagers-filter-losses" class="btn btn-secondary" style="padding:0.2rem 0.7rem;">Losses</button>
            <button id="wagers-filter-today" class="btn btn-secondary" style="padding:0.2rem 0.7rem;">Today</button>
          </div>
          <button id="wagers-refresh" class="btn btn-secondary" style="padding:0.25rem 0.7rem;font-size:0.75rem;">Refresh</button>
        </div>
      </div>
      <div id="wagers-content" class="small-text" style="margin-top:0.35rem; max-height: 220px; overflow-y: auto;">${
        currentUser
          ? "Loading your recent tournaments..."
          : "Log in and play tournaments to see your results here."
      }</div>
    </section>

  `;

  document.querySelectorAll("[data-game-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-game-id");
      const game = gameCards.find((g) => g.id === id);
      if (!game || game.comingSoon) {
        alert("This game is still being built.");
        return;
      }
      currentGameId = id;
      currentView = "game";
      render();
    });
  });

  if (supabaseClient && currentUser) {
    loadAndRenderWagers().catch((err) => console.error(err));

    const refreshBtn = document.getElementById("wagers-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        loadAndRenderWagers().catch((err) => console.error(err));
      });
    }

    const filterAll = document.getElementById("wagers-filter-all");
    const filterWins = document.getElementById("wagers-filter-wins");
    const filterLosses = document.getElementById("wagers-filter-losses");
    const filterToday = document.getElementById("wagers-filter-today");

    if (filterAll) {
      filterAll.addEventListener("click", () => {
        wagersFilter = "all";
        loadAndRenderWagers().catch((err) => console.error(err));
      });
    }
    if (filterWins) {
      filterWins.addEventListener("click", () => {
        wagersFilter = "wins";
        loadAndRenderWagers().catch((err) => console.error(err));
      });
    }
    if (filterLosses) {
      filterLosses.addEventListener("click", () => {
        wagersFilter = "losses";
        loadAndRenderWagers().catch((err) => console.error(err));
      });
    }
    if (filterToday) {
      filterToday.addEventListener("click", () => {
        wagersFilter = "today";
        loadAndRenderWagers().catch((err) => console.error(err));
      });
    }

  }
}

// --- Game screen + games ---

let reactionState = null;
let reactionTimeoutId = null;

let flappyState = null;
let flappyAnimId = null;

let stackState = null;
let stackAnimId = null;

let chickenState = null;
let chickenAnimId = null;

let speedDashState = null;
let speedDashAnimId = null;
let speedDashSubscription = null;

let germsState = null;
let nightShiftState = null;
let nightShiftMessageHandler = null;
let rollingRushState = null;
let rollingRushMessageHandler = null;
let germsWagerMode = "cash"; // "coin" or "cash" (coin wagers hidden for now)

function renderGameScreen() {
  const game = gameCards.find((g) => g.id === currentGameId);
  if (!game) {
    currentView = "hub";
    currentGameId = null;
    render();
    return;
  }

  mainContent.innerHTML = `
    <section class="card game-shell" id="game-shell">
      <div class="game-shell-header">
        <div class="game-shell-header-main">
          <div class="small-text">Playing</div>
          <div class="game-shell-title-row">
            <h2 class="section-title">${game.title}</h2>
            <span class="pill game-mode-pill">${game.mode}</span>
          </div>
        </div>
        <div class="game-shell-header-actions">
          <button
            class="btn btn-secondary fullscreen-icon-btn"
            id="game-fullscreen-toggle"
            aria-label="Enter full screen"
            title="Enter full screen"
          >⛶</button>
          <button class="btn btn-secondary" id="back-to-hub">Back to games</button>
        </div>
      </div>
      <p class="tagline">${game.description}</p>
      <div id="game-root" class="game-root"></div>
    </section>
  `;

  const backBtn = document.getElementById("back-to-hub");
  const shell = document.getElementById("game-shell");
  const fullscreenBtn = document.getElementById("game-fullscreen-toggle");

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      // If we're in browser fullscreen, exit it when going back to the hub.
      if (document.fullscreenElement) {
        document.exitFullscreen().catch((err) => console.error(err));
      }
      stopAllGames();
      currentView = "hub";
      currentGameId = null;
      render();
    });
  }

  if (fullscreenBtn && shell && shell.requestFullscreen) {
    fullscreenBtn.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        shell.requestFullscreen().catch((err) => console.error(err));
      } else {
        document.exitFullscreen().catch((err) => console.error(err));
      }
    });
  }

  if (currentGameId === "reaction-duel") {
    mountReactionDuel();
  } else if (currentGameId === "flappy-race") {
    mountFlappyRace();
  } else if (currentGameId === "stack-duel") {
    mountStackDuel();
  } else if (currentGameId === "chicken-run") {
    mountChickenRun();
  } else if (currentGameId === "speed-dash") {
    mountSpeedDash();
  } else if (currentGameId === "avoid-germs") {
    mountAvoidGerms();
  } else if (currentGameId === "night-shift") {
    mountNightShift();
  } else if (currentGameId === "rolling-rush") {
    mountRollingRush();
  } else {
    const root = document.getElementById("game-root");
    root.textContent = "Prototype coming soon.";
  }
}

function mountAvoidGerms() {
  const root = document.getElementById("game-root");
  root.innerHTML = `
    <div class="germs-layout">
      <div class="germs-top">
        <div class="small-text">Score</div>
        <div class="chicken-score" id="germs-score">0</div>

        <div class="mode-toggle" id="germs-mode-toggle" style="display:none;gap:0.25rem;margin-bottom:0.35rem;">
          <button class="btn btn-secondary" id="germs-mode-coin" style="padding:0.2rem 0.6rem;font-size:0.75rem;">Coins</button>
          <button class="btn btn-secondary active" id="germs-mode-cash" style="padding:0.2rem 0.6rem;font-size:0.75rem;">Cash</button>
        </div>

        <button class="btn btn-secondary" id="germs-wager">Start Tournament</button>

        <div id="germs-coin-controls" style="display:none;">
          <div class="bet-controls">
            <button class="bet-btn" id="germs-bet-down">-</button>
            <span class="bet-label" id="germs-bet-label">Entry fee: 100</span>
            <button class="bet-btn" id="germs-bet-up">+</button>
          </div>
          <div class="small-text" id="germs-payout" style="margin-top:0.15rem; min-height:1em;"></div>
        </div>

        <div id="germs-cash-controls" style="display:none;">
          <div class="bet-controls">
            <button class="bet-btn" id="germs-cash-down">-</button>
            <span class="bet-label" id="germs-cash-label">Entry: $1.00</span>
            <button class="bet-btn" id="germs-cash-up">+</button>
          </div>
          <div class="small-text" id="germs-cash-payout" style="margin-top:0.15rem; min-height:1em;">Win: $1.70</div>
        </div>
      </div>

      <div class="card" data-leaderboard-card="true" style="margin-top:0.5rem; margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
          <h3 class="section-title" style="margin-bottom:0;">Top 5 - Avoid the Germs</h3>
          <button id="germs-leaderboard-refresh" class="btn btn-secondary" style="padding:0.2rem 0.6rem;font-size:0.7rem;">Refresh</button>
        </div>
        <div id="germs-leaderboard" class="small-text" style="margin-top:0.4rem; max-height:180px; overflow-y:auto;"></div>
      </div>

      <div id="avoid-germs-container" class="avoid-germs-container"></div>
      <div class="small-text" style="margin-top:0.5rem;">Click Start Tournament to enter a wager, then click inside the game to dodge germs and collect rings.</div>
      <div class="small-text" id="germs-wager-result" style="margin-top:0.25rem; min-height:1em;"></div>
      <div id="germs-provably-fair" style="margin-top:0.5rem;display:none;"></div>
    </div>
  `;

  if (window.AvoidGerms) {
    window.AvoidGerms.mount("avoid-germs-container", {
      onScoreChange: (score) => {
        if (germsState) germsState.score = score;
        const scoreEl = document.getElementById("germs-score");
        if (scoreEl) scoreEl.textContent = score;
      },
      onGameOver: (score) => {
        if (germsState) germsState.score = score;
        handleGermsGameOver(score);
      },
    });
  } else {
    const container = document.getElementById("avoid-germs-container");
    if (container) container.textContent = "Failed to load game engine. Please refresh and try again.";
  }

  const wagerBtn = document.getElementById("germs-wager");
  if (wagerBtn) {
    wagerBtn.addEventListener("click", handleGermsWagerClick);
  }

  const coinToggle = document.getElementById("germs-mode-coin");
  const cashToggle = document.getElementById("germs-mode-cash");
  if (coinToggle) coinToggle.addEventListener("click", () => setGermsWagerMode("coin"));
  if (cashToggle) cashToggle.addEventListener("click", () => setGermsWagerMode("cash"));

  const betDown = document.getElementById("germs-bet-down");
  const betUp = document.getElementById("germs-bet-up");
  if (betDown) betDown.addEventListener("click", () => decreaseWagerAmount());
  if (betUp) betUp.addEventListener("click", () => increaseWagerAmount());

  const cashDown = document.getElementById("germs-cash-down");
  const cashUp = document.getElementById("germs-cash-up");
  if (cashDown) cashDown.addEventListener("click", () => decreaseCashEntry());
  if (cashUp) cashUp.addEventListener("click", () => increaseCashEntry());

  setGermsWagerMode(germsWagerMode);
  updateWagerButtons();
  updateGermsCashUI();

  loadLeaderboardForGame("avoid-germs", "germs-leaderboard");
  const lbRefresh = document.getElementById("germs-leaderboard-refresh");
  if (lbRefresh) {
    lbRefresh.addEventListener("click", () => {
      loadLeaderboardForGame("avoid-germs", "germs-leaderboard");
    });
  }

  // Re-attach pending wager UI state if a render() happened mid-wager
  if (germsState && germsState.inWager) {
    if (wagerBtn) wagerBtn.style.display = "none";
    const modeToggle = document.getElementById("germs-mode-toggle");
    if (modeToggle) modeToggle.style.display = "none";
    if (germsState.serverSeedHash) {
      const pfEl = document.getElementById("germs-provably-fair");
      if (pfEl) {
        pfEl.style.display = "block";
        pfEl.innerHTML = renderProvablyFairBadge(germsState.serverSeedHash, true);
        pfEl.onclick = () => window.showProvablyFairInfo(germsState.serverSeedHash, germsState.serverSeed, germsState.matchId);
      }
    }
  }
}

async function handleGermsWagerClick() {
  if (!supabaseClient || !currentUser) {
    openAuthModal("login");
    return;
  }

  const canPlay = await checkBanBeforeGame('avoid_germs');
  if (!canPlay) return;

  const btn = document.getElementById("germs-wager");
  if (!btn) return;
  const modeToggle = document.getElementById("germs-mode-toggle");

  const isCashMode = germsWagerMode === "cash";
  const wagerAmount = isCashMode ? null : getCurrentWagerAmount();
  const cashEntry = isCashMode ? getCurrentCashEntry() : null;

  const now = Date.now();
  const last = lastWagerAtByGame["avoid-germs"] || 0;
  if (now - last < WAGER_COOLDOWN_MS) {
    const remaining = Math.ceil((WAGER_COOLDOWN_MS - (now - last)) / 1000);
    alert(`Please wait ${remaining}s before starting another Avoid the Germs tournament.`);
    return;
  }

  if (germsState && germsState.inWager) {
    btn.style.display = "none";
    alert("You already have an active tournament run. Finish it before starting another.");
    return;
  }

  if (isCashMode) {
    if ((currentUser.cash_balance ?? 0) < cashEntry) {
      alert(`Not enough cash for a $${cashEntry.toFixed(2)} entry. Please deposit more.`);
      return;
    }
  } else {
    if ((currentUser.coin_balance ?? 0) < wagerAmount) {
      alert(`Not enough coins for a ${wagerAmount}-coin wager.`);
      return;
    }
  }

  btn.disabled = true;
  btn.style.display = "none";
  if (modeToggle) {
    modeToggle.style.display = "none";
  }

  try {
    let match, slot;

    if (isCashMode) {
      match = await createCashMatchForGame("avoid-germs", cashEntry);
      if (!match) {
        throw new Error("Could not create cash match.");
      }
      slot = match.player2_id === currentUser.id ? "player2" : "player1";
    } else {
      const result = await findOrCreateGermsMatch(wagerAmount);
      match = result.match;
      slot = result.slot;
      if (!match || !slot) {
        throw new Error("Could not start or join a wager match.");
      }
    }

    pendingGermsJoin = { matchId: match.id, slot, isCashMode, cashEntry };
    lastWagerAtByGame["avoid-germs"] = now;

    // Set state BEFORE triggering any balance refresh below, since
    // adjustCurrentUserCoins/loadCurrentUser trigger a full re-render that
    // remounts the game screen. mountAvoidGerms() checks germsState.inWager
    // to keep the wager button/toggle hidden on the freshly rendered DOM.
    germsState = germsState || {};
    germsState.inWager = true;
    germsState.matchId = match.id;
    germsState.playerSlot = slot;
    germsState.opponentName = null;
    germsState.gameOverReported = false;
    germsState.score = 0;
    germsState.wagerAmount = isCashMode ? null : wagerAmount;
    germsState.cashEntry = isCashMode ? cashEntry : null;
    germsState.isCashMode = isCashMode;
    germsState.provablyFairId = match.provablyFairId || null;
    germsState.serverSeedHash = match.serverSeedHash || null;
    germsState.serverSeed = match.serverSeed || null;
    germsState.antiCheatSession = AntiCheat.createSession('avoid_germs', match.id, currentUser.id);

    if (isCashMode) {
      await loadCurrentUser();
    } else {
      await adjustCurrentUserCoins(-wagerAmount);
    }

    try {
      const oppId = slot === "player1" ? match.player2_id : match.player1_id;
      if (oppId) {
        const { data: oppProfile, error: oppError } = await supabaseClient
          .from("profiles")
          .select("username")
          .eq("id", oppId)
          .maybeSingle();
        if (!oppError && oppProfile) {
          germsState.opponentName = oppProfile.username || "Unknown player";
        }
      }
    } catch (e) {
      console.error("Failed to load opponent for Germs wager banner", e);
    }

    // Force a fresh run for this wager (skips MainMenu, resets score to 0)
    if (window.AvoidGerms) {
      window.AvoidGerms.restart();
    }

    const resultEl = document.getElementById("germs-wager-result");
    if (resultEl) {
      const modeLabel = isCashMode ? `$${cashEntry.toFixed(2)} cash` : `${wagerAmount}-coin`;
      resultEl.textContent =
        slot === "player2"
          ? `Match found (${modeLabel})! Finish your run to record your score.`
          : `Match created (${modeLabel}). Finish your run to record your score.`;
    }

    const pfEl = document.getElementById("germs-provably-fair");
    if (pfEl && germsState.serverSeedHash) {
      pfEl.style.display = "block";
      pfEl.innerHTML = renderProvablyFairBadge(germsState.serverSeedHash, true);
      pfEl.onclick = () => window.showProvablyFairInfo(germsState.serverSeedHash, null, germsState.matchId);
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to start wager match.");
  } finally {
    if (btn && !(germsState && germsState.inWager)) {
      btn.disabled = false;
    }
  }
}

async function handleGermsGameOver(score) {
  if (
    !supabaseClient ||
    !currentUser ||
    !germsState?.inWager ||
    !germsState.matchId ||
    !germsState.playerSlot ||
    germsState.gameOverReported
  ) {
    return;
  }

  germsState.gameOverReported = true;
  germsState.score = score;

  const wasCashMode = germsState.isCashMode;
  const cashEntry = germsState.cashEntry;

  try {
    await submitMatchScore(germsState.matchId, germsState.playerSlot, score);
    const resultEl = document.getElementById("germs-wager-result");
    if (resultEl) {
      const modeLabel = wasCashMode && cashEntry ? `$${cashEntry.toFixed(2)} cash` : "coin";
      resultEl.textContent = `${modeLabel} run finished. Score: ${score}. Awaiting other player...`;
    }

    if (germsState.provablyFairId) {
      await ProvablyFair.revealGame(germsState.provablyFairId);
      const pfEl = document.getElementById("germs-provably-fair");
      if (pfEl && germsState.serverSeedHash && germsState.serverSeed) {
        pfEl.innerHTML = renderProvablyFairBadge(germsState.serverSeedHash, true);
        pfEl.onclick = () => window.showProvablyFairInfo(germsState.serverSeedHash, germsState.serverSeed, germsState.matchId);
      }
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to submit wager score.");
  } finally {
    germsState.inWager = false;
    germsState.matchId = null;
    germsState.playerSlot = null;
    germsState.isCashMode = false;
    germsState.cashEntry = null;

    pendingGermsJoin = null;

    const btn = document.getElementById("germs-wager");
    if (btn) {
      btn.disabled = false;
      btn.style.display = "";
    }
    const modeToggle = document.getElementById("germs-mode-toggle");
    if (modeToggle) {
      modeToggle.style.display = "";
    }
    setGermsWagerMode(germsWagerMode);
  }
}

function mountNightShift() {
  const root = document.getElementById("game-root");
  root.innerHTML = `
    <div class="germs-layout">
      <div class="germs-top">
        <div class="small-text">Best score this run: wave reached + zombies slain</div>
        <div class="chicken-score" id="night-shift-score">Wave 0 · 0 kills</div>

        <button class="btn btn-secondary" id="night-shift-wager">Start Tournament</button>

        <div id="night-shift-cash-controls">
          <div class="bet-controls">
            <button class="bet-btn" id="night-shift-cash-down">-</button>
            <span class="bet-label" id="night-shift-cash-label">Entry: $1.00</span>
            <button class="bet-btn" id="night-shift-cash-up">+</button>
          </div>
          <div class="small-text" id="night-shift-cash-payout" style="margin-top:0.15rem; min-height:1em;">Win: $1.70</div>
        </div>
      </div>

      <div class="card" data-leaderboard-card="true" style="margin-top:0.5rem; margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
          <h3 class="section-title" style="margin-bottom:0;">Top 5 - Night Shift</h3>
          <button id="night-shift-leaderboard-refresh" class="btn btn-secondary" style="padding:0.2rem 0.6rem;font-size:0.7rem;">Refresh</button>
        </div>
        <div id="night-shift-leaderboard" class="small-text" style="margin-top:0.4rem; max-height:180px; overflow-y:auto;"></div>
      </div>

      <div class="night-shift-frame-wrap" style="position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden;">
        <iframe
          id="night-shift-iframe"
          src="games/night-shift/night-shift.html"
          style="width:100%;height:100%;border:0;display:block;"
          allow="autoplay"
        ></iframe>
      </div>
      <div class="small-text" style="margin-top:0.5rem;">Click Start Tournament to enter a cash wager, then click inside the game and press "BEGIN THE SHIFT" to play. Survive as many endless zombie waves as you can — the game never ends until you fall, so your final wave and kill count are submitted as your score.</div>
      <div class="small-text" id="night-shift-wager-result" style="margin-top:0.25rem; min-height:1em;"></div>
      <div id="night-shift-provably-fair" style="margin-top:0.5rem;display:none;"></div>
    </div>
  `;

  const wagerBtn = document.getElementById("night-shift-wager");
  if (wagerBtn) {
    wagerBtn.addEventListener("click", handleNightShiftWagerClick);
  }

  const cashDown = document.getElementById("night-shift-cash-down");
  const cashUp = document.getElementById("night-shift-cash-up");
  if (cashDown) cashDown.addEventListener("click", () => decreaseCashEntry());
  if (cashUp) cashUp.addEventListener("click", () => increaseCashEntry());

  updateNightShiftCashUI();

  loadLeaderboardForGame("night-shift", "night-shift-leaderboard");
  const lbRefresh = document.getElementById("night-shift-leaderboard-refresh");
  if (lbRefresh) {
    lbRefresh.addEventListener("click", () => {
      loadLeaderboardForGame("night-shift", "night-shift-leaderboard");
    });
  }

  if (nightShiftMessageHandler) {
    window.removeEventListener("message", nightShiftMessageHandler);
  }
  nightShiftMessageHandler = (event) => {
    if (!event.data || event.data.type !== "nightshift-gameover") return;
    const iframe = document.getElementById("night-shift-iframe");
    if (!iframe || event.source !== iframe.contentWindow) return;

    const wave = Number(event.data.wave) || 0;
    const kills = Number(event.data.kills) || 0;
    const survivedSeconds = Number(event.data.survivedSeconds) || 0;
    const scoreEl = document.getElementById("night-shift-score");
    if (scoreEl) scoreEl.textContent = `Wave ${wave} · ${kills} kills`;

    // Score weights wave far above kills so reaching a higher wave always
    // beats more kills at a lower wave (waves double in size each time).
    const score = wave * 100000 + kills;
    handleNightShiftGameOver(score, wave, kills, survivedSeconds);
  };
  window.addEventListener("message", nightShiftMessageHandler);

  // Re-attach pending wager UI state if a render() happened mid-wager
  if (nightShiftState && nightShiftState.inWager) {
    if (wagerBtn) wagerBtn.style.display = "none";
    if (nightShiftState.serverSeedHash) {
      const pfEl = document.getElementById("night-shift-provably-fair");
      if (pfEl) {
        pfEl.style.display = "block";
        pfEl.innerHTML = renderProvablyFairBadge(nightShiftState.serverSeedHash, true);
        pfEl.onclick = () => window.showProvablyFairInfo(nightShiftState.serverSeedHash, nightShiftState.serverSeed, nightShiftState.matchId);
      }
    }
  }
}

function updateNightShiftCashUI() {
  const entry = getCurrentCashEntry();
  const total = entry * 2;
  const fee = total * 0.15;
  const payout = total - fee;

  const cashLabel = document.getElementById("night-shift-cash-label");
  if (cashLabel) {
    cashLabel.textContent = `Entry: $${entry.toFixed(2)}`;
  }
  const cashPayout = document.getElementById("night-shift-cash-payout");
  if (cashPayout) {
    cashPayout.textContent = `Win: $${payout.toFixed(2)}`;
  }
  const cashUp = document.getElementById("night-shift-cash-up");
  const cashDown = document.getElementById("night-shift-cash-down");
  if (cashUp) cashUp.disabled = currentCashEntryIndex >= CASH_ENTRY_AMOUNTS.length - 1;
  if (cashDown) cashDown.disabled = currentCashEntryIndex <= 0;
}

async function handleNightShiftWagerClick() {
  if (!supabaseClient || !currentUser) {
    openAuthModal("login");
    return;
  }

  const canPlay = await checkBanBeforeGame('night_shift');
  if (!canPlay) return;

  const btn = document.getElementById("night-shift-wager");
  if (!btn) return;

  const cashEntry = getCurrentCashEntry();

  const now = Date.now();
  const last = lastWagerAtByGame["night-shift"] || 0;
  if (now - last < WAGER_COOLDOWN_MS) {
    const remaining = Math.ceil((WAGER_COOLDOWN_MS - (now - last)) / 1000);
    alert(`Please wait ${remaining}s before starting another Night Shift tournament.`);
    return;
  }

  if (nightShiftState && nightShiftState.inWager) {
    btn.style.display = "none";
    alert("You already have an active tournament run. Finish it before starting another.");
    return;
  }

  if ((currentUser.cash_balance ?? 0) < cashEntry) {
    alert(`Not enough cash for a $${cashEntry.toFixed(2)} entry. Please deposit more.`);
    return;
  }

  btn.disabled = true;
  btn.style.display = "none";

  try {
    const match = await createCashMatchForGame("night-shift", cashEntry);
    if (!match) {
      throw new Error("Could not create cash match.");
    }
    const slot = match.player2_id === currentUser.id ? "player2" : "player1";

    lastWagerAtByGame["night-shift"] = now;

    nightShiftState = nightShiftState || {};
    nightShiftState.inWager = true;
    nightShiftState.matchId = match.id;
    nightShiftState.playerSlot = slot;
    nightShiftState.gameOverReported = false;
    nightShiftState.cashEntry = cashEntry;
    nightShiftState.provablyFairId = match.provablyFairId || null;
    nightShiftState.serverSeedHash = match.serverSeedHash || null;
    nightShiftState.serverSeed = match.serverSeed || null;

    await loadCurrentUser();

    // Force a fresh run for this wager (skips the start screen, resets score to 0)
    const iframe = document.getElementById("night-shift-iframe");
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: "nightshift-start-wager" }, "*");
    }

    const scoreEl = document.getElementById("night-shift-score");
    if (scoreEl) scoreEl.textContent = "Wave 0 · 0 kills";

    const resultEl = document.getElementById("night-shift-wager-result");
    if (resultEl) {
      resultEl.textContent = `Match ${slot === "player2" ? "found" : "created"} ($${cashEntry.toFixed(2)} cash). Survive as long as you can — your final wave/kills are your score.`;
    }

    const pfEl = document.getElementById("night-shift-provably-fair");
    if (pfEl && nightShiftState.serverSeedHash) {
      pfEl.style.display = "block";
      pfEl.innerHTML = renderProvablyFairBadge(nightShiftState.serverSeedHash, true);
      pfEl.onclick = () => window.showProvablyFairInfo(nightShiftState.serverSeedHash, null, nightShiftState.matchId);
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to start wager match.");
  } finally {
    if (btn && !(nightShiftState && nightShiftState.inWager)) {
      btn.disabled = false;
    }
  }
}

async function handleNightShiftGameOver(score, wave, kills, survivedSeconds) {
  if (
    !supabaseClient ||
    !currentUser ||
    !nightShiftState?.inWager ||
    !nightShiftState.matchId ||
    !nightShiftState.playerSlot ||
    nightShiftState.gameOverReported
  ) {
    return;
  }

  nightShiftState.gameOverReported = true;

  const cashEntry = nightShiftState.cashEntry;

  try {
    await submitMatchScore(nightShiftState.matchId, nightShiftState.playerSlot, score);
    const resultEl = document.getElementById("night-shift-wager-result");
    if (resultEl) {
      resultEl.textContent = `$${cashEntry.toFixed(2)} cash run finished. Wave ${wave}, ${kills} kills. Awaiting other player...`;
    }

    if (nightShiftState.provablyFairId) {
      await ProvablyFair.revealGame(nightShiftState.provablyFairId);
      const pfEl = document.getElementById("night-shift-provably-fair");
      if (pfEl && nightShiftState.serverSeedHash && nightShiftState.serverSeed) {
        pfEl.innerHTML = renderProvablyFairBadge(nightShiftState.serverSeedHash, true);
        pfEl.onclick = () => window.showProvablyFairInfo(nightShiftState.serverSeedHash, nightShiftState.serverSeed, nightShiftState.matchId);
      }
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to submit wager score.");
  } finally {
    nightShiftState.inWager = false;
    nightShiftState.matchId = null;
    nightShiftState.playerSlot = null;
    nightShiftState.cashEntry = null;

    const btn = document.getElementById("night-shift-wager");
    if (btn) {
      btn.disabled = false;
      btn.style.display = "";
    }
  }
}

function mountRollingRush() {
  const root = document.getElementById("game-root");
  root.innerHTML = `
    <div class="germs-layout">
      <div class="germs-top">
        <div class="small-text">Score this run</div>
        <div class="chicken-score" id="rolling-rush-score">0</div>

        <button class="btn btn-secondary" id="rolling-rush-wager">Start Tournament</button>

        <div id="rolling-rush-cash-controls">
          <div class="bet-controls">
            <button class="bet-btn" id="rolling-rush-cash-down">-</button>
            <span class="bet-label" id="rolling-rush-cash-label">Entry: $1.00</span>
            <button class="bet-btn" id="rolling-rush-cash-up">+</button>
          </div>
          <div class="small-text" id="rolling-rush-cash-payout" style="margin-top:0.15rem; min-height:1em;">Win: $1.70</div>
        </div>
      </div>

      <div class="card" data-leaderboard-card="true" style="margin-top:0.5rem; margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
          <h3 class="section-title" style="margin-bottom:0;">Top 5 - Rolling Rush</h3>
          <button id="rolling-rush-leaderboard-refresh" class="btn btn-secondary" style="padding:0.2rem 0.6rem;font-size:0.7rem;">Refresh</button>
        </div>
        <div id="rolling-rush-leaderboard" class="small-text" style="margin-top:0.4rem; max-height:180px; overflow-y:auto;"></div>
      </div>

      <div class="rolling-rush-frame-wrap" style="position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden;">
        <iframe
          id="rolling-rush-iframe"
          src="games/lost-ball/index.html"
          style="width:100%;height:100%;border:0;display:block;"
          allow="autoplay"
        ></iframe>
      </div>
      <div class="small-text" style="margin-top:0.5rem;">Click Start Tournament for a fresh cash run, then click inside the game to begin (5s countdown), and use arrow keys / A-D to dodge left/right and Space/Up to jump. Crashing ends the run — your final score is shown and submitted.</div>
      <div class="small-text" id="rolling-rush-wager-result" style="margin-top:0.25rem; min-height:1em;"></div>
      <div id="rolling-rush-provably-fair" style="margin-top:0.5rem;display:none;"></div>
    </div>
  `;

  const wagerBtn = document.getElementById("rolling-rush-wager");
  if (wagerBtn) {
    wagerBtn.addEventListener("click", handleRollingRushWagerClick);
  }

  const cashDown = document.getElementById("rolling-rush-cash-down");
  const cashUp = document.getElementById("rolling-rush-cash-up");
  if (cashDown) cashDown.addEventListener("click", () => decreaseCashEntry());
  if (cashUp) cashUp.addEventListener("click", () => increaseCashEntry());

  updateRollingRushCashUI();

  loadLeaderboardForGame("rolling-rush", "rolling-rush-leaderboard");
  const lbRefresh = document.getElementById("rolling-rush-leaderboard-refresh");
  if (lbRefresh) {
    lbRefresh.addEventListener("click", () => {
      loadLeaderboardForGame("rolling-rush", "rolling-rush-leaderboard");
    });
  }

  if (rollingRushMessageHandler) {
    window.removeEventListener("message", rollingRushMessageHandler);
  }
  rollingRushMessageHandler = (event) => {
    if (!event.data || event.data.type !== "lostball-crash") return;
    const iframe = document.getElementById("rolling-rush-iframe");
    if (!iframe || event.source !== iframe.contentWindow) return;

    const score = Number(event.data.score) || 0;
    const scoreEl = document.getElementById("rolling-rush-score");
    if (scoreEl) scoreEl.textContent = String(score);

    handleRollingRushGameOver(score);
  };
  window.addEventListener("message", rollingRushMessageHandler);

  // Re-attach pending wager UI state if a render() happened mid-wager
  if (rollingRushState && rollingRushState.inWager) {
    if (wagerBtn) wagerBtn.style.display = "none";
    if (rollingRushState.serverSeedHash) {
      const pfEl = document.getElementById("rolling-rush-provably-fair");
      if (pfEl) {
        pfEl.style.display = "block";
        pfEl.innerHTML = renderProvablyFairBadge(rollingRushState.serverSeedHash, true);
        pfEl.onclick = () => window.showProvablyFairInfo(rollingRushState.serverSeedHash, rollingRushState.serverSeed, rollingRushState.matchId);
      }
    }
  }
}

function updateRollingRushCashUI() {
  const entry = getCurrentCashEntry();
  const total = entry * 2;
  const fee = total * 0.15;
  const payout = total - fee;

  const cashLabel = document.getElementById("rolling-rush-cash-label");
  if (cashLabel) {
    cashLabel.textContent = `Entry: $${entry.toFixed(2)}`;
  }
  const cashPayout = document.getElementById("rolling-rush-cash-payout");
  if (cashPayout) {
    cashPayout.textContent = `Win: $${payout.toFixed(2)}`;
  }
  const cashUp = document.getElementById("rolling-rush-cash-up");
  const cashDown = document.getElementById("rolling-rush-cash-down");
  if (cashUp) cashUp.disabled = currentCashEntryIndex >= CASH_ENTRY_AMOUNTS.length - 1;
  if (cashDown) cashDown.disabled = currentCashEntryIndex <= 0;
}

async function handleRollingRushWagerClick() {
  if (!supabaseClient || !currentUser) {
    openAuthModal("login");
    return;
  }

  const canPlay = await checkBanBeforeGame('rolling_rush');
  if (!canPlay) return;

  const btn = document.getElementById("rolling-rush-wager");
  if (!btn) return;

  const cashEntry = getCurrentCashEntry();

  const now = Date.now();
  const last = lastWagerAtByGame["rolling-rush"] || 0;
  if (now - last < WAGER_COOLDOWN_MS) {
    const remaining = Math.ceil((WAGER_COOLDOWN_MS - (now - last)) / 1000);
    alert(`Please wait ${remaining}s before starting another Rolling Rush tournament.`);
    return;
  }

  if (rollingRushState && rollingRushState.inWager) {
    btn.style.display = "none";
    alert("You already have an active tournament run. Finish it before starting another.");
    return;
  }

  if ((currentUser.cash_balance ?? 0) < cashEntry) {
    alert(`Not enough cash for a $${cashEntry.toFixed(2)} entry. Please deposit more.`);
    return;
  }

  btn.disabled = true;
  btn.style.display = "none";

  try {
    const match = await createCashMatchForGame("rolling-rush", cashEntry);
    if (!match) {
      throw new Error("Could not create cash match.");
    }
    const slot = match.player2_id === currentUser.id ? "player2" : "player1";

    lastWagerAtByGame["rolling-rush"] = now;

    rollingRushState = rollingRushState || {};
    rollingRushState.inWager = true;
    rollingRushState.matchId = match.id;
    rollingRushState.playerSlot = slot;
    rollingRushState.gameOverReported = false;
    rollingRushState.cashEntry = cashEntry;
    rollingRushState.provablyFairId = match.provablyFairId || null;
    rollingRushState.serverSeedHash = match.serverSeedHash || null;
    rollingRushState.serverSeed = match.serverSeed || null;

    await loadCurrentUser();

    // Force a fresh run for this wager by fully reloading the iframe
    // (the underlying game loop never truly stops on its own).
    const iframe = document.getElementById("rolling-rush-iframe");
    if (iframe) {
      iframe.src = iframe.src;
    }

    const scoreEl = document.getElementById("rolling-rush-score");
    if (scoreEl) scoreEl.textContent = "0";

    const resultEl = document.getElementById("rolling-rush-wager-result");
    if (resultEl) {
      resultEl.textContent = `Match ${slot === "player2" ? "found" : "created"} ($${cashEntry.toFixed(2)} cash). Dodge as long as you can — your score at the first crash is submitted.`;
    }

    const pfEl = document.getElementById("rolling-rush-provably-fair");
    if (pfEl && rollingRushState.serverSeedHash) {
      pfEl.style.display = "block";
      pfEl.innerHTML = renderProvablyFairBadge(rollingRushState.serverSeedHash, true);
      pfEl.onclick = () => window.showProvablyFairInfo(rollingRushState.serverSeedHash, null, rollingRushState.matchId);
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to start wager match.");
  } finally {
    if (btn && !(rollingRushState && rollingRushState.inWager)) {
      btn.disabled = false;
    }
  }
}

async function handleRollingRushGameOver(score) {
  if (
    !supabaseClient ||
    !currentUser ||
    !rollingRushState?.inWager ||
    !rollingRushState.matchId ||
    !rollingRushState.playerSlot ||
    rollingRushState.gameOverReported
  ) {
    return;
  }

  rollingRushState.gameOverReported = true;

  const cashEntry = rollingRushState.cashEntry;

  try {
    await submitMatchScore(rollingRushState.matchId, rollingRushState.playerSlot, score);
    const resultEl = document.getElementById("rolling-rush-wager-result");
    if (resultEl) {
      resultEl.textContent = `$${cashEntry.toFixed(2)} cash run finished. Score: ${score}. Awaiting other player...`;
    }

    if (rollingRushState.provablyFairId) {
      await ProvablyFair.revealGame(rollingRushState.provablyFairId);
      const pfEl = document.getElementById("rolling-rush-provably-fair");
      if (pfEl && rollingRushState.serverSeedHash && rollingRushState.serverSeed) {
        pfEl.innerHTML = renderProvablyFairBadge(rollingRushState.serverSeedHash, true);
        pfEl.onclick = () => window.showProvablyFairInfo(rollingRushState.serverSeedHash, rollingRushState.serverSeed, rollingRushState.matchId);
      }
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to submit wager score.");
  } finally {
    rollingRushState.inWager = false;
    rollingRushState.matchId = null;
    rollingRushState.playerSlot = null;
    rollingRushState.cashEntry = null;

    const btn = document.getElementById("rolling-rush-wager");
    if (btn) {
      btn.disabled = false;
      btn.style.display = "";
    }
  }
}

function stopAllGames() {
  if (reactionTimeoutId) {
    clearTimeout(reactionTimeoutId);
    reactionTimeoutId = null;
  }
  reactionState = null;

  if (flappyAnimId) {
    cancelAnimationFrame(flappyAnimId);
    flappyAnimId = null;
  }
  flappyState = null;

  if (stackAnimId) {
    cancelAnimationFrame(stackAnimId);
    stackAnimId = null;
  }
  stackState = null;

  if (chickenAnimId) {
    cancelAnimationFrame(chickenAnimId);
    chickenAnimId = null;
  }
  chickenState = null;

  if (speedDashAnimId) {
    cancelAnimationFrame(speedDashAnimId);
    speedDashAnimId = null;
  }
  if (speedDashSubscription) {
    speedDashSubscription.unsubscribe();
    speedDashSubscription = null;
  }
  speedDashState = null;

  if (window.AvoidGerms) {
    window.AvoidGerms.destroy();
  }
  germsState = null;

  if (nightShiftMessageHandler) {
    window.removeEventListener("message", nightShiftMessageHandler);
    nightShiftMessageHandler = null;
  }
  nightShiftState = null;

  if (rollingRushMessageHandler) {
    window.removeEventListener("message", rollingRushMessageHandler);
    rollingRushMessageHandler = null;
  }
  rollingRushState = null;
}

// --- Reaction Duel (single-player prototype) ---

function mountReactionDuel() {
  const root = document.getElementById("game-root");
  root.innerHTML = `
    <div class="reaction-layout">
      <div class="reaction-panel">
        <div class="reaction-status" id="reaction-status">Tap start, then wait for GREEN...</div>
        <button class="btn" id="reaction-start">Start round</button>
        <button class="btn btn-secondary" id="reaction-click" disabled>Click when green</button>
      </div>
      <div class="reaction-stats">
        <div class="small-text">Last reaction time</div>
        <div class="reaction-time" id="reaction-last">-- ms</div>
        <div class="small-text" style="margin-top:0.5rem;">Best time</div>
        <div class="reaction-time" id="reaction-best">-- ms</div>
      </div>
      <div class="reaction-wager-panel">
        <button class="btn btn-secondary" id="reaction-wager">Start Tournament</button>
        <!-- Coin controls hidden for now -->
        <div id="reaction-coin-controls" style="display:none;">
          <div class="bet-controls">
            <button class="bet-btn" id="reaction-bet-down">-</button>
            <span class="bet-label" id="reaction-bet-label">Entry fee: 100</span>
            <button class="bet-btn" id="reaction-bet-up">+</button>
          </div>
          <div class="small-text" id="reaction-payout" style="margin-top:0.15rem; min-height:1em;"></div>
        </div>
        <!-- Cash entry controls -->
        <div id="reaction-cash-controls">
          <div class="bet-controls">
            <button class="bet-btn" id="reaction-cash-down">-</button>
            <span class="bet-label" id="reaction-cash-label">Entry: $1.00</span>
            <button class="bet-btn" id="reaction-cash-up">+</button>
          </div>
          <div class="small-text" id="reaction-cash-payout" style="margin-top:0.15rem; min-height:1em;">Win: $1.70</div>
        </div>
        <div class="small-text" id="reaction-wager-result" style="margin-top:0.25rem; min-height:1em;"></div>
        <div id="reaction-provably-fair" style="margin-top:0.5rem;display:none;"></div>
      </div>
      <div class="card" data-leaderboard-card="true" style="margin-top:0.5rem; margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
          <h3 class="section-title" style="margin-bottom:0;">Top 5 - Reaction Duel</h3>
          <button id="reaction-leaderboard-refresh" class="btn btn-secondary" style="padding:0.2rem 0.6rem;font-size:0.7rem;">Refresh</button>
        </div>
        <div id="reaction-leaderboard" class="small-text" style="margin-top:0.4rem; max-height:180px; overflow-y:auto;"></div>
      </div>
    </div>
  `;

  const wagerBtn = document.getElementById("reaction-wager");
  const betDownBtn = document.getElementById("reaction-bet-down");
  const betUpBtn = document.getElementById("reaction-bet-up");

  reactionState = {
    waiting: false,
    canClick: false,
    signalTime: 0,
    best: null,
    inWager: false,
    matchId: null,
    playerSlot: null,
    wagerAmount: null,
    isCashMode: false,
    cashEntry: null,
    gameOverReported: false,
    // Anti-cheat
    antiCheatSession: null,
    suspiciouslyFastCount: 0, // Track impossibly fast reactions
  };

  document
    .getElementById("reaction-start")
    .addEventListener("click", handleReactionStart);
  document
    .getElementById("reaction-click")
    .addEventListener("click", handleReactionClick);

  if (wagerBtn) {
    wagerBtn.addEventListener("click", handleReactionWagerClick);
  }
  if (betDownBtn) {
    betDownBtn.addEventListener("click", () => {
      decreaseWagerAmount();
    });
  }
  if (betUpBtn) {
    betUpBtn.addEventListener("click", () => {
      increaseWagerAmount();
    });
  }

  const reactionCashDown = document.getElementById("reaction-cash-down");
  const reactionCashUp = document.getElementById("reaction-cash-up");
  if (reactionCashDown) reactionCashDown.addEventListener("click", () => decreaseCashEntry());
  if (reactionCashUp) reactionCashUp.addEventListener("click", () => increaseCashEntry());

  // Ensure labels reflect the current wager amount
  updateWagerButtons();
  updateReactionCashUI();

  // Load leaderboard for this game
  loadLeaderboardForGame("reaction-duel", "reaction-leaderboard");

  const reactionLbRefresh = document.getElementById("reaction-leaderboard-refresh");
  if (reactionLbRefresh) {
    reactionLbRefresh.addEventListener("click", () => {
      loadLeaderboardForGame("reaction-duel", "reaction-leaderboard");
    });
  }
}

function handleReactionStart() {
  const statusEl = document.getElementById("reaction-status");
  const clickBtn = document.getElementById("reaction-click");

  // Only allow play when a wager is active
  if (!reactionState.inWager) {
    const resultEl = document.getElementById("reaction-wager-result");
    if (resultEl) {
      resultEl.textContent = "Start a wager to play this game.";
    }
    return;
  }

  if (reactionTimeoutId) {
    clearTimeout(reactionTimeoutId);
    reactionTimeoutId = null;
  }

  reactionState.waiting = true;
  reactionState.canClick = false;
  clickBtn.disabled = true;
  statusEl.textContent = "Wait for GREEN...";
  statusEl.classList.remove("reaction-ready");

  const delay = 1500 + Math.random() * 2500;
  reactionTimeoutId = setTimeout(() => {
    reactionState.waiting = false;
    reactionState.canClick = true;
    reactionState.signalTime = performance.now();
    clickBtn.disabled = false;
    statusEl.textContent = "CLICK!";
    statusEl.classList.add("reaction-ready");
  }, delay);
}

function handleReactionClick() {
  const statusEl = document.getElementById("reaction-status");
  const lastEl = document.getElementById("reaction-last");
  const bestEl = document.getElementById("reaction-best");

  if (!reactionState.canClick) {
    statusEl.textContent = "Too early! Wait for GREEN, then click.";
    statusEl.classList.remove("reaction-ready");
    return;
  }

  const now = performance.now();
  const diff = Math.round(now - reactionState.signalTime);
  reactionState.canClick = false;

  // Anti-cheat: Detect impossibly fast reactions (human minimum is ~150ms for visual)
  if (diff < 100 && reactionState.antiCheatSession) {
    reactionState.suspiciouslyFastCount++;
    
    // If multiple impossibly fast reactions, flag as cheater
    if (reactionState.suspiciouslyFastCount >= 2) {
      AntiCheat.handleDetection(
        AntiCheat.sessions[reactionState.antiCheatSession],
        'HIGH',
        { reactionTime: diff, suspiciousCount: reactionState.suspiciouslyFastCount, reason: 'IMPOSSIBLE_REACTION_TIME' }
      );
      statusEl.textContent = "Suspicious activity detected.";
      return;
    }
  }

  lastEl.textContent = `${diff} ms`;
  statusEl.textContent = "Nice! Hit start to try again.";
  statusEl.classList.remove("reaction-ready");

  if (reactionState.best === null || diff < reactionState.best) {
    reactionState.best = diff;
    bestEl.textContent = `${diff} ms`;
  }

  // If this was a wager run, submit the reaction time as the score (lower is better).
  if (
    reactionState.inWager &&
    reactionState.matchId &&
    reactionState.playerSlot &&
    !reactionState.gameOverReported
  ) {
    reactionState.gameOverReported = true;
    handleReactionGameOver(diff);
  }
}

async function handleReactionWagerClick() {
  if (!supabaseClient || !currentUser) {
    openAuthModal("login");
    return;
  }

  // Check if player is banned
  const canPlay = await checkBanBeforeGame('reaction_duel');
  if (!canPlay) return;

  const btn = document.getElementById("reaction-wager");
  if (!btn) return;

  const cashEntry = getCurrentCashEntry();
  const now = Date.now();
  const last = lastWagerAtByGame["reaction-duel"] || 0;
  if (now - last < WAGER_COOLDOWN_MS) {
    const remaining = Math.ceil((WAGER_COOLDOWN_MS - (now - last)) / 1000);
    alert(`Please wait ${remaining}s before starting another Reaction wager.`);
    return;
  }

  if (reactionState && reactionState.inWager) {
    alert("You already have an active wager round. Finish it before starting another.");
    return;
  }

  if ((currentUser.cash_balance ?? 0) < cashEntry) {
    alert(`Not enough cash for a $${cashEntry.toFixed(2)} entry. Please deposit more.`);
    return;
  }

  btn.disabled = true;

  try {
    const match = await createCashMatchForGame("reaction-duel", cashEntry);
    if (!match) {
      throw new Error("Could not create cash match.");
    }
    const slot = match.player2_id === currentUser.id ? "player2" : "player1";

    await loadCurrentUser();
    lastWagerAtByGame["reaction-duel"] = now;

    reactionState.inWager = true;
    reactionState.matchId = match.id;
    reactionState.playerSlot = slot;
    reactionState.wagerAmount = null;
    reactionState.isCashMode = true;
    reactionState.cashEntry = cashEntry;
    reactionState.gameOverReported = false;
    // Provably Fair data
    reactionState.provablyFairId = match.provablyFairId || null;
    reactionState.serverSeedHash = match.serverSeedHash || null;
    reactionState.serverSeed = match.serverSeed || null;
    // Create anti-cheat session for this game
    reactionState.antiCheatSession = AntiCheat.createSession('reaction_duel', match.id, currentUser.id);
    reactionState.suspiciouslyFastCount = 0;

    const statusEl = document.getElementById("reaction-status");
    if (statusEl) {
      const modeLabel = `$${cashEntry.toFixed(2)} cash`;
      statusEl.textContent =
        slot === "player2"
          ? `Joined a ${modeLabel} wager. Start a round and click when it turns green!`
          : `Created a ${modeLabel} wager. Start a round and click when it turns green!`;
    }

    const resultEl = document.getElementById("reaction-wager-result");
    if (resultEl) {
      resultEl.textContent = "Wager active - your next valid reaction will be submitted.";
    }
    
    // Show Provably Fair badge
    const pfEl = document.getElementById("reaction-provably-fair");
    if (pfEl && reactionState.serverSeedHash) {
      pfEl.style.display = "block";
      pfEl.innerHTML = renderProvablyFairBadge(reactionState.serverSeedHash, true);
      pfEl.onclick = () => window.showProvablyFairInfo(reactionState.serverSeedHash, null, reactionState.matchId);
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to start Reaction wager.");
  } finally {
    btn.disabled = false;
  }
}

async function handleReactionGameOver(reactionMs) {
  if (
    !supabaseClient ||
    !currentUser ||
    !reactionState?.inWager ||
    !reactionState.matchId ||
    !reactionState.playerSlot
  ) {
    return;
  }

  try {
    await submitMatchScore(reactionState.matchId, reactionState.playerSlot, reactionMs);
    const resultEl = document.getElementById("reaction-wager-result");
    if (resultEl) {
      resultEl.textContent = `Wager round finished. Reaction submitted: ${reactionMs} ms. Awaiting results...`;
    }
    
    // Reveal Provably Fair seed
    if (reactionState.provablyFairId) {
      await ProvablyFair.revealGame(reactionState.provablyFairId);
      const pfEl = document.getElementById("reaction-provably-fair");
      if (pfEl && reactionState.serverSeedHash && reactionState.serverSeed) {
        pfEl.innerHTML = renderProvablyFairBadge(reactionState.serverSeedHash, true);
        pfEl.onclick = () => window.showProvablyFairInfo(reactionState.serverSeedHash, reactionState.serverSeed, reactionState.matchId);
      }
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to submit wager reaction.");
  } finally {
    reactionState.inWager = false;
    reactionState.matchId = null;
    reactionState.playerSlot = null;
    reactionState.wagerAmount = null;
    reactionState.gameOverReported = false;
  }
}

// --- Flappy Race (single-player Flappy Bird style) ---

function mountFlappyRace() {
  const root = document.getElementById("game-root");
  root.innerHTML = `
    <div class="flappy-layout">
      <div class="flappy-top">
        <div class="small-text">Score</div>
        <div class="flappy-score" id="flappy-score">0</div>

        <!-- Mode toggle: Coins / Cash (coin option hidden for now) -->
        <div class="mode-toggle" id="flappy-mode-toggle" style="display:none;gap:0.25rem;margin-bottom:0.35rem;">
          <button class="btn btn-secondary" id="flappy-mode-coin" style="padding:0.2rem 0.6rem;font-size:0.75rem;">Coins</button>
          <button class="btn btn-secondary active" id="flappy-mode-cash" style="padding:0.2rem 0.6rem;font-size:0.75rem;">Cash</button>
        </div>

        <!-- Player count selector -->
        <div style="margin-bottom:0.35rem;">
          <label class="small-text">Players:</label>
          <select id="flappy-players" style="margin-left:0.5rem;padding:0.15rem 0.3rem;font-size:0.75rem;">
            <option value="2">2 players</option>
            <option value="3">3 players</option>
          </select>
        </div>

        <button class="btn btn-secondary" id="flappy-wager">Start Tournament</button>

        <!-- Coin controls (default) -->
        <div id="flappy-coin-controls">
          <div class="bet-controls">
            <button class="bet-btn" id="flappy-bet-down">-</button>
            <span class="bet-label" id="flappy-bet-label">Entry fee: 100</span>
            <button class="bet-btn" id="flappy-bet-up">+</button>
          </div>
          <div class="small-text" id="flappy-payout" style="margin-top:0.15rem; min-height:1em;"></div>
        </div>

        <!-- Cash controls (hidden by default) -->
        <div id="flappy-cash-controls" style="display:none;">
          <div class="bet-controls">
            <button class="bet-btn" id="flappy-cash-down">-</button>
            <span class="bet-label" id="flappy-cash-label">Entry: $1.00</span>
            <button class="bet-btn" id="flappy-cash-up">+</button>
          </div>
          <div class="small-text" id="flappy-cash-payout" style="margin-top:0.15rem; min-height:1em;">Win: $1.70</div>
        </div>

        <button id="flappy-restart-hidden" style="display:none;"></button>
      </div>
      <div class="card" data-leaderboard-card="true" style="margin-top:0.5rem; margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
          <h3 class="section-title" style="margin-bottom:0;">Top 5 - Flappy Race</h3>
          <button id="flappy-leaderboard-refresh" class="btn btn-secondary" style="padding:0.2rem 0.6rem;font-size:0.7rem;">Refresh</button>
        </div>
        <div id="flappy-leaderboard" class="small-text" style="margin-top:0.4rem; max-height:180px; overflow-y:auto;"></div>
      </div>
      <canvas id="flappy-canvas" width="480" height="380" class="flappy-canvas"></canvas>
      <div class="small-text" style="margin-top:0.5rem;">Click or press space to start, then flap to stay between the pipes.</div>
      <div class="small-text" id="flappy-wager-result" style="margin-top:0.25rem; min-height:1em;"></div>
      <div id="flappy-provably-fair" style="margin-top:0.5rem;display:none;"></div>
    </div>
  `;

  const canvas = document.getElementById("flappy-canvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("flappy-score");
  const wagerBtn = document.getElementById("flappy-wager");
  const flappyBetDown = document.getElementById("flappy-bet-down");
  const flappyBetUp = document.getElementById("flappy-bet-up");

  // Safety: if a previous Flappy loop was running, stop it before starting a new one
  if (flappyAnimId) {
    cancelAnimationFrame(flappyAnimId);
    flappyAnimId = null;
  }

  flappyState = {
    birdY: canvas.height * 0.65,
    birdVel: 0,
    gravity: 0.045,
    flapStrength: -2.6,
    pipes: [],
    pipeGap: 180,
    pipeSpacing: 360,
    pipeWidth: 35,
    frame: 0,
    firstPipeSpawned: false,
    ticksSinceStart: 0,
    score: 0,
    lastPipeSpeed: 0,
    alive: true,
    started: false,
    startCountdownUntil: null,
    gameOverReported: false,
    inWager: false,
    matchId: null,
    playerSlot: null, // "player1" or "player2" when in a wager
    opponentName: null,
    wagerAmount: null,
    isCashMode: false,
    cashEntry: null,
    // Anti-cheat
    antiCheatSession: null,
  };

  function spawnPipe() {
    const minHeight = 40;
    const maxHeight = canvas.height - flappyState.pipeGap - 60;
    const topHeight = minHeight + Math.random() * (maxHeight - minHeight);
    flappyState.pipes.push({
      x: canvas.width,
      top: topHeight,
      passed: false,
    });
  }

  function resetFlappy() {
    flappyState.birdY = canvas.height * 0.65;
    flappyState.birdVel = 0;
    flappyState.pipes = [];
    flappyState.frame = 0;
    flappyState.firstPipeSpawned = false;
    flappyState.ticksSinceStart = 0;
    flappyState.score = 0;
    flappyState.alive = true;
    flappyState.started = false;
    flappyState.startCountdownUntil = null;
    flappyState.gameOverReported = false;
    scoreEl.textContent = "0";
  }

  function flap() {
    // Only allow play when a wager is active
    if (!flappyState.inWager) {
      const resultEl = document.getElementById("flappy-wager-result");
      if (resultEl) {
        resultEl.textContent = "Start a wager to play this game.";
      }
      return;
    }
    if (!flappyState.alive) return;
    
    // Anti-cheat: Record action and check for bot behavior
    if (flappyState.antiCheatSession) {
      const result = AntiCheat.recordAction(flappyState.antiCheatSession, 'click');
      if (!result.allowed) {
        // Cheater detected - kill the bird
        flappyState.alive = false;
        return;
      }
    }
    
    if (!flappyState.started) {
      // First input: start the run immediately and apply the first flap.
      flappyState.started = true;
      flappyState.ticksSinceStart = 0;
      // Spawn the very first pipe right away so the run begins immediately.
      if (!flappyState.firstPipeSpawned) {
        spawnPipe();
        flappyState.firstPipeSpawned = true;
      }
    }

    flappyState.birdVel = flappyState.flapStrength;
  }

  function update() {
    const s = flappyState;
    s.frame++;

    // If the run hasn't started yet, wait for the first flap.
    if (!s.started) {
      return;
    }

    // Track how long we've been in the active run
    s.ticksSinceStart++;

    // Difficulty ramp: as score increases, slightly shrink the gap and
    // speed pipes up. Spacing (distance between pipes) stays constant.
    let currentGap = flappyState.pipeGap; // base gap from initial state (e.g. 190)

    if (s.score >= 50) {
      currentGap -= 40;
    } else if (s.score >= 40) {
      currentGap -= 32;
    } else if (s.score >= 30) {
      currentGap -= 24;
    } else if (s.score >= 20) {
      currentGap -= 16;
    }

    // Don't let the gap get ridiculously small
    currentGap = Math.max(currentGap, 120);
    flappyState.pipeGap = currentGap;

    const spacingFrames = Math.round(s.pipeSpacing / 2);
    if (s.frame % spacingFrames === 0) {
      spawnPipe();
      s.firstPipeSpawned = true;
    }

    // Use a single gentle gravity for the whole run so the jump feels consistent.
    s.birdVel += s.gravity;
    s.birdY += s.birdVel;

    // Pipes start at a faster base speed and ramp up slightly more with score.
    const pipeSpeed = 2.8 + Math.min(s.score, 50) * 0.03;
    s.lastPipeSpeed = pipeSpeed;
    s.pipes.forEach((p) => {
      p.x -= pipeSpeed;
    });
    s.pipes = s.pipes.filter((p) => p.x + flappyState.pipeWidth > -10);

    const birdX = 80;
    const birdR = 10;

    if (s.birdY + birdR > canvas.height || s.birdY - birdR < 0) {
      s.alive = false;
    }

    s.pipes.forEach((p) => {
      const inXRange = birdX + birdR > p.x && birdX - birdR < p.x + s.pipeWidth;
      const inTop = s.birdY - birdR < p.top;
      const inBottom = s.birdY + birdR > p.top + s.pipeGap;
      if (inXRange && (inTop || inBottom)) {
        s.alive = false;
      }

      if (!p.passed && p.x + s.pipeWidth < birdX) {
        p.passed = true;
        s.score += 1;
        scoreEl.textContent = String(s.score);
      }
    });

    if (!s.alive && !s.gameOverReported) {
      s.gameOverReported = true;
      handleFlappyGameOver();
    }
  }

  function draw() {
    const s = flappyState;
    if (!s) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#22c55e";
    s.pipes.forEach((p) => {
      ctx.fillRect(p.x, 0, s.pipeWidth, p.top);
      ctx.fillRect(p.x, p.top + s.pipeGap, s.pipeWidth, canvas.height - (p.top + s.pipeGap));
    });

    ctx.fillStyle = "#fde047";
    const birdX = 80;
    const birdR = 10;
    ctx.beginPath();
    ctx.arc(birdX, s.birdY, birdR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#e5e7eb";
    ctx.font = "14px system-ui";
    ctx.fillText(`Score: ${s.score}`, canvas.width - 110, 24);

    // Active wager banner in the HUD
    if (s.inWager && s.matchId) {
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(8, 8, 220, 32);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "11px system-ui";
      const oppLabel = s.opponentName
        ? `vs ${s.opponentName}`
        : "Matching opponent...";
      // Show cash or coin amount
      let bannerText;
      if (s.isCashMode && s.cashEntry) {
        bannerText = `$${s.cashEntry.toFixed(2)} cash entry`;
      } else {
        const bannerAmount = s.wagerAmount || getCurrentWagerAmount();
        bannerText = `${bannerAmount}-coin wager`;
      }
      ctx.fillText(bannerText, 14, 22);
      ctx.fillText(oppLabel, 14, 34);
    }

    // Debug: show current pipe speed so we can confirm it's identical
    // between wager and non-wager runs.
    ctx.font = "10px system-ui";
    ctx.fillText(`Spd: ${s.lastPipeSpeed.toFixed(2)}`, canvas.width - 110, 38);

    if (!s.started) {
      // Show simple ready text before the first flap
      ctx.fillStyle = "rgba(15,23,42,0.7)";
      ctx.fillRect(0, canvas.height / 2 - 30, canvas.width, 60);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "16px system-ui";
      const text = "Click or press space to start";
      const textWidth = ctx.measureText(text).width;
      ctx.fillText(text, canvas.width / 2 - textWidth / 2, canvas.height / 2 + 5);
    } else if (!s.alive) {
      ctx.fillStyle = "rgba(15,23,42,0.7)";
      ctx.fillRect(0, canvas.height / 2 - 30, canvas.width, 60);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "16px system-ui";
      const text = "Game over - press Restart";
      const textWidth = ctx.measureText(text).width;
      ctx.fillText(text, canvas.width / 2 - textWidth / 2, canvas.height / 2 + 5);
    }
  }

  function loop() {
    if (flappyState && flappyState.alive) {
      update();
    }
    draw();
    flappyAnimId = requestAnimationFrame(loop);
  }

  resetFlappy();
  loop();

  // If we have a pending join/start from history or a new wager, attach it now.
  if (pendingFlappyJoin && pendingFlappyJoin.matchId && pendingFlappyJoin.slot) {
    flappyState.inWager = true;
    flappyState.matchId = pendingFlappyJoin.matchId;
    flappyState.gameOverReported = false;
    flappyState.playerSlot = pendingFlappyJoin.slot; // "player1" or "player2"
    flappyState.isCashMode = pendingFlappyJoin.isCashMode || false;
    flappyState.cashEntry = pendingFlappyJoin.cashEntry || null;
    pendingFlappyJoin = null;
    const resultEl = document.getElementById("flappy-wager-result");
    if (resultEl) {
      resultEl.textContent = "Match attached. Finish your run to record your score.";
    }
  }

  if (flappyState.inWager && wagerBtn) {
    wagerBtn.style.display = "none";
  }

  function handleKey(e) {
    if (e.code === "Space") {
      e.preventDefault();
      flap();
    }
  }

  function handleClick() {
    flap();
  }

  canvas.addEventListener("mousedown", handleClick);
  window.addEventListener("keydown", handleKey);

  const restartHidden = document.getElementById("flappy-restart-hidden");
  if (restartHidden) {
    restartHidden.addEventListener("click", () => {
      resetFlappy();
    });
  }

  document.getElementById("flappy-wager").addEventListener("click", handleFlappyWagerClick);

  if (flappyBetDown) {
    flappyBetDown.addEventListener("click", decreaseWagerAmount);
  }
  if (flappyBetUp) {
    flappyBetUp.addEventListener("click", increaseWagerAmount);
  }

  // Cash entry controls
  const flappyCashDown = document.getElementById("flappy-cash-down");
  const flappyCashUp = document.getElementById("flappy-cash-up");
  if (flappyCashDown) {
    flappyCashDown.addEventListener("click", decreaseCashEntry);
  }
  if (flappyCashUp) {
    flappyCashUp.addEventListener("click", increaseCashEntry);
  }

  // Mode toggle: Coins / Cash
  const modeCoinBtn = document.getElementById("flappy-mode-coin");
  const modeCashBtn = document.getElementById("flappy-mode-cash");
  if (modeCoinBtn) {
    modeCoinBtn.addEventListener("click", () => setFlappyWagerMode("coin"));
  }
  if (modeCashBtn) {
    modeCashBtn.addEventListener("click", () => setFlappyWagerMode("cash"));
  }

  // Player count selector
  const flappyPlayersSelect = document.getElementById("flappy-players");
  if (flappyPlayersSelect) {
    flappyPlayersSelect.addEventListener("change", () => {
      updateWagerButtons();
      updateFlappyCashUI();
    });
  }

  // Initialize to current mode
  setFlappyWagerMode(flappyWagerMode);

  // Ensure button labels reflect the current wager amount
  updateWagerButtons();
  updateFlappyCashUI();

  // Load leaderboard for this game
  loadLeaderboardForGame("flappy-race", "flappy-leaderboard");

  const lbRefresh = document.getElementById("flappy-leaderboard-refresh");
  if (lbRefresh) {
    lbRefresh.addEventListener("click", () => {
      loadLeaderboardForGame("flappy-race", "flappy-leaderboard");
    });
  }
}

async function handleFlappyWagerClick() {
  if (!supabaseClient || !currentUser) {
    openAuthModal("login");
    return;
  }

  // Check if player is banned
  const canPlay = await checkBanBeforeGame('flappy_race');
  if (!canPlay) return;

  const btn = document.getElementById("flappy-wager");
  if (!btn) return;
  const modeToggle = document.querySelector(".mode-toggle");

  const isCashMode = flappyWagerMode === "cash";
  const wagerAmount = isCashMode ? null : getCurrentWagerAmount();
  const cashEntry = isCashMode ? getCurrentCashEntry() : null;

  const now = Date.now();
  const last = lastWagerAtByGame["flappy-race"] || 0;
  if (now - last < WAGER_COOLDOWN_MS) {
    const remaining = Math.ceil((WAGER_COOLDOWN_MS - (now - last)) / 1000);
    alert(`Please wait ${remaining}s before starting another Flappy tournament.`);
    return;
  }

  if (flappyState && flappyState.inWager) {
    btn.style.display = "none";
    alert("You already have an active tournament run. Finish it before starting another.");
    return;
  }

  // Balance check
  if (isCashMode) {
    if ((currentUser.cash_balance ?? 0) < cashEntry) {
      alert(`Not enough cash for a $${cashEntry.toFixed(2)} entry. Please deposit more.`);
      return;
    }
  } else {
    if ((currentUser.coin_balance ?? 0) < wagerAmount) {
      alert(`Not enough coins for a ${wagerAmount}-coin wager.`);
      return;
    }
  }

  btn.disabled = true;
  btn.style.display = "none";
  if (modeToggle) {
    modeToggle.style.display = "none";
  }

  try {
    let match, slot;

    if (isCashMode) {
      // Cash mode: call rpc_join_cash_match (deducts cash_balance server-side)
      match = await createCashMatchForGame("flappy-race", cashEntry);
      if (!match) {
        throw new Error("Could not create cash match.");
      }
      // Determine slot based on which player we are
      slot = match.player2_id === currentUser.id ? "player2" : "player1";
      // Refresh user data to get updated cash_balance
      await loadCurrentUser();
    } else {
      // Coin mode: existing flow
      const result = await findOrCreateFlappyMatch(wagerAmount);
      match = result.match;
      slot = result.slot;
      if (!match || !slot) {
        throw new Error("Could not start or join a wager match.");
      }
      // Pay the wager up front from this player's balance
      await adjustCurrentUserCoins(-wagerAmount);
    }

    // Stash this match so that if a render() happens,
    // mountFlappyRace can re-attach the wager state and keep the button hidden.
    pendingFlappyJoin = { matchId: match.id, slot, isCashMode, cashEntry };

    // Record cooldown timestamp for this game
    lastWagerAtByGame["flappy-race"] = now;

    if (flappyState) {
      flappyState.inWager = true;
      flappyState.matchId = match.id;
      flappyState.playerSlot = slot;
      flappyState.opponentName = null;
      flappyState.gameOverReported = false;
      flappyState.wagerAmount = isCashMode ? null : wagerAmount;
      flappyState.cashEntry = isCashMode ? cashEntry : null;
      flappyState.isCashMode = isCashMode;
      // Provably Fair data
      flappyState.provablyFairId = match.provablyFairId || null;
      flappyState.serverSeedHash = match.serverSeedHash || null;
      flappyState.serverSeed = match.serverSeed || null;
      // Create anti-cheat session for this game
      flappyState.antiCheatSession = AntiCheat.createSession('flappy_race', match.id, currentUser.id);

      if (btn) {
        btn.style.display = "none";
      }
      if (modeToggle) {
        modeToggle.style.display = "none";
      }

      // Load opponent usernames for HUD banner (supports 2 or 3 players)
      try {
        const oppIds = [];
        if (match.player1_id && match.player1_id !== currentUser.id) oppIds.push(match.player1_id);
        if (match.player2_id && match.player2_id !== currentUser.id) oppIds.push(match.player2_id);
        if (match.player3_id && match.player3_id !== currentUser.id) oppIds.push(match.player3_id);
        
        if (oppIds.length > 0) {
          const { data: oppProfiles, error: oppError } = await supabaseClient
            .from("profiles")
            .select("username")
            .in("id", oppIds);
          if (!oppError && oppProfiles && oppProfiles.length > 0) {
            const names = oppProfiles.map(p => p.username || "Player").join(" & ");
            flappyState.opponentName = names;
          }
        }
      } catch (e) {
        console.error("Failed to load opponents for Flappy wager banner", e);
      }

      // Start a fresh run for this wager via hidden restart button
      const restartHidden = document.getElementById("flappy-restart-hidden");
      if (restartHidden) {
        restartHidden.click();
      }

      const resultEl = document.getElementById("flappy-wager-result");
      if (resultEl) {
        const modeLabel = isCashMode ? `$${cashEntry.toFixed(2)} cash` : `${wagerAmount}-coin`;
        if (slot === "player2") {
          resultEl.textContent = `Match found (${modeLabel})! Finish your run to record your score.`;
        } else {
          resultEl.textContent = `Match created (${modeLabel}). Finish your run to record your score.`;
        }
      }
      
      // Show Provably Fair badge
      const pfEl = document.getElementById("flappy-provably-fair");
      if (pfEl && flappyState.serverSeedHash) {
        pfEl.style.display = "block";
        pfEl.innerHTML = renderProvablyFairBadge(flappyState.serverSeedHash, true);
        pfEl.onclick = () => window.showProvablyFairInfo(flappyState.serverSeedHash, null, flappyState.matchId);
      }
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to start wager match.");
  } finally {
    if (btn && !(flappyState && flappyState.inWager)) {
      btn.disabled = false;
    }
  }
}

async function handleFlappyGameOver() {
  if (
    !supabaseClient ||
    !currentUser ||
    !flappyState?.inWager ||
    !flappyState.matchId ||
    !flappyState.playerSlot
  ) {
    return;
  }

  const wasCashMode = flappyState.isCashMode;
  const cashEntry = flappyState.cashEntry;

  const matchIdToCheck = flappyState.matchId;
  
  try {
    await submitMatchScore(flappyState.matchId, flappyState.playerSlot, flappyState.score);
    const resultEl = document.getElementById("flappy-wager-result");
    if (resultEl) {
      const modeLabel = wasCashMode && cashEntry ? `$${cashEntry.toFixed(2)} cash` : "coin";
      resultEl.textContent = `${modeLabel} run finished. Score: ${flappyState.score}. Awaiting other players...`;
    }
    
    // Reveal Provably Fair seed
    if (flappyState.provablyFairId) {
      await ProvablyFair.revealGame(flappyState.provablyFairId);
      const pfEl = document.getElementById("flappy-provably-fair");
      if (pfEl && flappyState.serverSeedHash && flappyState.serverSeed) {
        pfEl.innerHTML = renderProvablyFairBadge(flappyState.serverSeedHash, true);
        pfEl.onclick = () => window.showProvablyFairInfo(flappyState.serverSeedHash, flappyState.serverSeed, flappyState.matchId);
      }
    }
    
    // Start polling for match completion (for 3-player games especially)
    pollForMatchResult(matchIdToCheck);
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to submit wager score.");
  } finally {
    flappyState.inWager = false;
    flappyState.matchId = null;
    flappyState.playerSlot = null;
    flappyState.isCashMode = false;
    flappyState.cashEntry = null;

    // Clear pending join so re-entering the game doesn't re-attach old match
    pendingFlappyJoin = null;

    const btn = document.getElementById("flappy-wager");
    if (btn) {
      btn.disabled = false;
      btn.style.display = "";
    }
    // Re-show mode toggle
    const modeToggle = document.querySelector(".mode-toggle");
    if (modeToggle) {
      modeToggle.style.display = "";
    }
    // Re-show the appropriate entry controls based on current mode
    setFlappyWagerMode(flappyWagerMode);
  }
}

// Poll for match result completion (handles 3-player games)
async function pollForMatchResult(matchId, attempts = 0) {
  if (!supabaseClient || !currentUser || attempts > 30) return; // Max 30 attempts (60 seconds)
  
  try {
    const { data: match, error } = await supabaseClient
      .from("matches")
      .select("id, game_id, wager, cash_entry, currency, status, player1_id, player2_id, player3_id, player1_score, player2_score, player3_score, max_players, winner_id")
      .eq("id", matchId)
      .single();
    
    if (error || !match) return;
    
    // If match already complete, show result
    if (match.status === "complete" && match.winner_id !== undefined) {
      await loadCurrentUser();
      const resultEl = document.getElementById("flappy-wager-result");
      if (resultEl) {
        const isCashMatch = match.currency === "CASH";
        const entryAmount = isCashMatch ? match.cash_entry : match.wager;
        const playerCount = match.max_players || 2;
        const total = entryAmount * playerCount;
        const fee = isCashMatch ? (total * 0.15) : Math.round(total * 0.15);
        const prize = total - fee;
        
        if (!match.winner_id) {
          resultEl.innerHTML = `<span style="color:#fbbf24;font-weight:bold;">🤝 TIE!</span> Entry refunded`;
        } else if (match.winner_id === currentUser.id) {
          const prizeLabel = isCashMatch ? `$${prize.toFixed(2)}` : `${prize} coins`;
          resultEl.innerHTML = `<span style="color:#22c55e;font-weight:bold;">🏆 YOU WON!</span> +${prizeLabel}`;
        } else {
          const lossLabel = isCashMatch ? `$${entryAmount.toFixed(2)}` : `${entryAmount} coins`;
          resultEl.innerHTML = `<span style="color:#ef4444;font-weight:bold;">😢 YOU LOST</span> -${lossLabel}`;
        }
      }
      return;
    }
    
    // Check if all scores are in - if so, try to determine winner
    const maxPlayers = match.max_players || 2;
    const allScoresIn = match.player1_score !== null && 
                        match.player2_score !== null &&
                        (maxPlayers < 3 || match.player3_score !== null);
    
    if (allScoresIn && !match.winner_id) {
      // All scores in, determine winner
      const scores = [
        { id: match.player1_id, score: match.player1_score || 0 },
        { id: match.player2_id, score: match.player2_score || 0 },
      ];
      if (match.player3_id) {
        scores.push({ id: match.player3_id, score: match.player3_score || 0 });
      }
      scores.sort((a, b) => b.score - a.score);
      
      const winnerId = scores[0].score > scores[1].score ? scores[0].id : null;
      
      // Update match with winner
      await supabaseClient
        .from("matches")
        .update({ status: "complete", winner_id: winnerId })
        .eq("id", matchId);
      
      // Settle the match
      try {
        await supabaseClient.rpc("rpc_settle_match", { p_match_id: matchId });
      } catch (e) {
        console.error("Failed to settle match", e);
      }
      
      // Refresh and show result
      await loadCurrentUser();
      pollForMatchResult(matchId, 30); // Final check
      return;
    }
    
    // Still waiting - poll again in 2 seconds
    setTimeout(() => pollForMatchResult(matchId, attempts + 1), 2000);
  } catch (e) {
    console.error("Poll error:", e);
  }
}

async function handleFlappyPageExit() {
  if (
    !supabaseClient ||
    !currentUser
  ) {
    return;
  }

  // Flappy Race auto-submit
  if (
    flappyState &&
    flappyState.inWager &&
    flappyState.matchId &&
    flappyState.playerSlot
  ) {
    try {
      await submitMatchScore(
        flappyState.matchId,
        flappyState.playerSlot,
        flappyState.score
      );
    } catch (e) {
      console.error("Failed to submit Flappy score on page exit", e);
    }
    // Clear pending join after submitting
    pendingFlappyJoin = null;
  }

  // Stack Duel auto-submit
  if (
    stackState &&
    stackState.inWager &&
    stackState.matchId &&
    stackState.playerSlot
  ) {
    try {
      await submitMatchScore(
        stackState.matchId,
        stackState.playerSlot,
        stackState.score
      );
    } catch (e) {
      console.error("Failed to submit Stack Duel score on page exit", e);
    }
  }

  // Chicken Run auto-submit (distance score)
  if (
    chickenState &&
    chickenState.inWager &&
    chickenState.matchId &&
    chickenState.playerSlot
  ) {
    try {
      await submitMatchScore(
        chickenState.matchId,
        chickenState.playerSlot,
        chickenState.score
      );
    } catch (e) {
      console.error("Failed to submit Chicken Run score on page exit", e);
    }
  }
}

// --- Stack Duel (single-player tower stack) ---

function mountStackDuel() {
  const root = document.getElementById("game-root");
  root.innerHTML = `
    <div class="stack-layout">
      <div class="stack-top">
        <div class="small-text">Height</div>
        <div class="stack-score" id="stack-score">0</div>
        <button class="btn btn-secondary" id="stack-wager">Start Tournament</button>
        <!-- Coin controls hidden for now -->
        <div id="stack-coin-controls" style="display:none;">
          <div class="bet-controls">
            <button class="bet-btn" id="stack-bet-down">-</button>
            <span class="bet-label" id="stack-bet-label">Entry fee: 100</span>
            <button class="bet-btn" id="stack-bet-up">+</button>
          </div>
          <div class="small-text" id="stack-payout" style="margin-top:0.15rem; min-height:1em;"></div>
        </div>
        <!-- Cash entry controls -->
        <div id="stack-cash-controls">
          <div class="bet-controls">
            <button class="bet-btn" id="stack-cash-down">-</button>
            <span class="bet-label" id="stack-cash-label">Entry: $1.00</span>
            <button class="bet-btn" id="stack-cash-up">+</button>
          </div>
          <div class="small-text" id="stack-cash-payout" style="margin-top:0.15rem; min-height:1em;">Win: $1.70</div>
        </div>
        <button id="stack-restart-hidden" style="display:none;"></button>
      </div>
      <div class="card" data-leaderboard-card="true" style="margin-top:0.5rem; margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
          <h3 class="section-title" style="margin-bottom:0;">Top 5 - Stack Duel</h3>
          <button id="stack-leaderboard-refresh" class="btn btn-secondary" style="padding:0.2rem 0.6rem;font-size:0.7rem;">Refresh</button>
        </div>
        <div id="stack-leaderboard" class="small-text" style="margin-top:0.4rem; max-height:180px; overflow-y:auto;"></div>
      </div>
      <div class="stack-help small-text">Click to drop the moving block. The misaligned part falls off, and the next block gets smaller.</div>
      <canvas id="stack-canvas" width="360" height="320" class="stack-canvas"></canvas>
      <div class="small-text" id="stack-wager-result" style="margin-top:0.25rem; min-height:1em;"></div>
      <div id="stack-provably-fair" style="margin-top:0.5rem;display:none;"></div>
    </div>
  `;

  const canvas = document.getElementById("stack-canvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("stack-score");
  const wagerBtn = document.getElementById("stack-wager");
  const stackBetDown = document.getElementById("stack-bet-down");
  const stackBetUp = document.getElementById("stack-bet-up");

  // Safety: if a previous Stack Duel loop was running, stop it before starting a new one
  if (stackAnimId) {
    cancelAnimationFrame(stackAnimId);
    stackAnimId = null;
  }

  stackState = {
    blocks: [],
    active: null,
    speed: 1.4,
    direction: 1,
    levelHeight: 16,
    score: 0,
    running: true,
    cameraOffset: 0,
    inWager: false,
    matchId: null,
    playerSlot: null,
    opponentName: null,
    gameOverReported: false,
    wagerAmount: null,
    isCashMode: false,
    cashEntry: null,
    // Anti-cheat
    antiCheatSession: null,
  };

  function initStack() {
    stackState.blocks = [];
    stackState.speed = 1.4;
    stackState.direction = 1;
    const baseWidth = 200;
    const baseX = (canvas.width - baseWidth) / 2;
    const baseY = canvas.height - stackState.levelHeight;
    stackState.blocks.push({ x: baseX, y: baseY, width: baseWidth });
    spawnActive();
    stackState.score = 1;
    scoreEl.textContent = String(stackState.score);
    stackState.running = true;
    stackState.cameraOffset = 0;
    const resultEl = document.getElementById("stack-wager-result");
    if (resultEl) {
      resultEl.textContent = "";
    }
  }

  function spawnActive() {
    const last = stackState.blocks[stackState.blocks.length - 1];
    const width = last.width;
    const y = last.y - stackState.levelHeight;
    const startX = 10;
    stackState.active = { x: startX, y, width };
    stackState.direction = 1;
  }

  function dropActive() {
    // Only allow play when a wager is active
    if (!stackState.inWager) {
      const resultEl = document.getElementById("stack-wager-result");
      if (resultEl) {
        resultEl.textContent = "Start a wager to play this game.";
      }
      return;
    }
    if (!stackState.active || !stackState.running) return;
    
    // Anti-cheat: Record action and check for bot behavior
    if (stackState.antiCheatSession) {
      const result = AntiCheat.recordAction(stackState.antiCheatSession, 'click');
      if (!result.allowed) {
        // Cheater detected - end game
        stackState.running = false;
        stackState.active = null;
        return;
      }
    }

    const last = stackState.blocks[stackState.blocks.length - 1];
    const a = stackState.active;

    const overlapLeft = Math.max(a.x, last.x);
    const overlapRight = Math.min(a.x + a.width, last.x + last.width);
    const overlapWidth = overlapRight - overlapLeft;

    if (overlapWidth <= 8) {
      // Missed too much -> game over
      stackState.running = false;
      stackState.active = null;
      // If this was a wager run, trigger game-over handling once.
      if (
        supabaseClient &&
        currentUser &&
        stackState.inWager &&
        stackState.matchId &&
        stackState.playerSlot &&
        !stackState.gameOverReported
      ) {
        stackState.gameOverReported = true;
        // Fire and forget; any errors are handled inside handleStackGameOver.
        handleStackGameOver();
      }
      return;
    }

    stackState.blocks.push({ x: overlapLeft, y: a.y, width: overlapWidth });
    stackState.score = stackState.blocks.length;
    scoreEl.textContent = String(stackState.score);

    // Slightly increase speed and spawn next (gradual ramp-up)
    stackState.speed = Math.min(stackState.speed + 0.08, 3.5);
    spawnActive();
  }

  function updateStack() {
    if (!stackState.running || !stackState.active) return;

    const a = stackState.active;
    a.x += stackState.speed * stackState.direction;

    if (a.x <= 0) {
      a.x = 0;
      stackState.direction = 1;
    } else if (a.x + a.width >= canvas.width) {
      a.x = canvas.width - a.width;
      stackState.direction = -1;
    }

    // Move camera so the active block stays near a fixed height, even for very tall towers
    const topVisibleThreshold = 70;
    const desiredOffset = a.y - topVisibleThreshold;
    stackState.cameraOffset = desiredOffset;
  }

  function drawStack() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw stacked blocks with vertical camera offset
    stackState.blocks.forEach((b, i) => {
      const t = i / Math.max(1, stackState.blocks.length - 1);
      const drawY = b.y - stackState.cameraOffset;
      if (drawY + stackState.levelHeight < 0 || drawY > canvas.height) return;
      ctx.fillStyle = `hsl(${200 + t * 80}, 70%, 55%)`;
      ctx.fillRect(b.x, drawY, b.width, stackState.levelHeight);
    });

    // Active block
    if (stackState.active) {
      ctx.fillStyle = "#f97316";
      const drawY = stackState.active.y - stackState.cameraOffset;
      ctx.fillRect(
        stackState.active.x,
        drawY,
        stackState.active.width,
        stackState.levelHeight
      );
    }

    // Active wager banner in the HUD
    if (stackState.inWager && stackState.matchId) {
      const bannerAmount = stackState.wagerAmount || getCurrentWagerAmount();
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(8, 8, 220, 32);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "11px system-ui";
      const oppLabel = stackState.opponentName
        ? `vs ${stackState.opponentName}`
        : "Matching opponent...";
      ctx.fillText(`${bannerAmount}-coin wager`, 14, 22);
      ctx.fillText(oppLabel, 14, 34);
    }

    if (!stackState.running) {
      ctx.fillStyle = "rgba(15,23,42,0.72)";
      ctx.fillRect(0, canvas.height / 2 - 30, canvas.width, 60);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "16px system-ui";
      const text = "Tower fell - press Restart";
      const textWidth = ctx.measureText(text).width;
      ctx.fillText(text, canvas.width / 2 - textWidth / 2, canvas.height / 2 + 5);
    }
  }

  function loop() {
    updateStack();
    drawStack();
    stackAnimId = requestAnimationFrame(loop);
  }

  initStack();
  loop();

  function handleClick() {
    dropActive();
  }

  canvas.addEventListener("mousedown", handleClick);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      dropActive();
    }
  });

  const stackRestartHidden = document.getElementById("stack-restart-hidden");
  if (stackRestartHidden) {
    stackRestartHidden.addEventListener("click", () => {
      initStack();
      stackState.gameOverReported = false;
    });
  }

  // Attach any pending wager join created before this mount.
  if (pendingStackJoin && pendingStackJoin.matchId && pendingStackJoin.slot) {
    stackState.inWager = true;
    stackState.matchId = pendingStackJoin.matchId;
    stackState.playerSlot = pendingStackJoin.slot;
    stackState.gameOverReported = false;
    stackState.isCashMode = pendingStackJoin.isCashMode || false;
    stackState.cashEntry = pendingStackJoin.cashEntry || null;
    pendingStackJoin = null;
    const resultEl = document.getElementById("stack-wager-result");
    if (resultEl) {
      resultEl.textContent = "Match attached. Finish your run to record your score.";
    }
  }

  if (stackState.inWager && wagerBtn) {
    wagerBtn.style.display = "none";
  }

  // Hide wager toggle while a wager is active
  const stackToggleBtn = document.getElementById("stack-wager-toggle");
  if (stackState.inWager && stackToggleBtn) {
    stackToggleBtn.style.display = "none";
  }

  if (wagerBtn) {
    wagerBtn.addEventListener("click", handleStackWagerClick);
  }

  if (stackBetDown) {
    stackBetDown.addEventListener("click", () => {
      decreaseWagerAmount();
    });
  }
  if (stackBetUp) {
    stackBetUp.addEventListener("click", () => {
      increaseWagerAmount();
    });
  }

  const stackCashDown = document.getElementById("stack-cash-down");
  const stackCashUp = document.getElementById("stack-cash-up");
  if (stackCashDown) stackCashDown.addEventListener("click", () => decreaseCashEntry());
  if (stackCashUp) stackCashUp.addEventListener("click", () => increaseCashEntry());

  // Load leaderboard for this game
  loadLeaderboardForGame("stack-duel", "stack-leaderboard");

  const stackLbRefresh = document.getElementById("stack-leaderboard-refresh");
  if (stackLbRefresh) {
    stackLbRefresh.addEventListener("click", () => {
      loadLeaderboardForGame("stack-duel", "stack-leaderboard");
    });
  }

  // Ensure wager labels and payout reflect the current amount on mount
  updateWagerButtons();
  updateStackCashUI();
}

async function handleStackWagerClick() {
  if (!supabaseClient || !currentUser) {
    openAuthModal("login");
    return;
  }

  // Check if player is banned
  const canPlay = await checkBanBeforeGame('stack_duel');
  if (!canPlay) return;

  const btn = document.getElementById("stack-wager");
  if (!btn) return;
  const toggleBtn = document.getElementById("stack-wager-toggle");

  const cashEntry = getCurrentCashEntry();

  const now = Date.now();
  const last = lastWagerAtByGame["stack-duel"] || 0;
  if (now - last < WAGER_COOLDOWN_MS) {
    const remaining = Math.ceil((WAGER_COOLDOWN_MS - (now - last)) / 1000);
    alert(`Please wait ${remaining}s before starting another Stack wager.`);
    return;
  }

  if (stackState && stackState.inWager) {
    btn.style.display = "none";
    alert("You already have an active wager run. Finish it before starting another.");
    return;
  }

  if ((currentUser.cash_balance ?? 0) < cashEntry) {
    alert(`Not enough cash for a $${cashEntry.toFixed(2)} entry. Please deposit more.`);
    return;
  }

  btn.disabled = true;
  btn.style.display = "none";
  if (toggleBtn) {
    toggleBtn.style.display = "none";
  }

  try {
    const match = await createCashMatchForGame("stack-duel", cashEntry);
    if (!match) {
      throw new Error("Could not create cash match.");
    }
    const slot = match.player2_id === currentUser.id ? "player2" : "player1";

    pendingStackJoin = { matchId: match.id, slot, isCashMode: true, cashEntry };

    await loadCurrentUser();

    // Record cooldown timestamp for this game
    lastWagerAtByGame["stack-duel"] = now;

    if (stackState) {
      stackState.inWager = true;
      stackState.matchId = match.id;
      stackState.playerSlot = slot;
      stackState.opponentName = null;
      stackState.gameOverReported = false;
      stackState.isCashMode = true;
      stackState.cashEntry = cashEntry;
      // Provably Fair data
      stackState.provablyFairId = match.provablyFairId || null;
      stackState.serverSeedHash = match.serverSeedHash || null;
      stackState.serverSeed = match.serverSeed || null;
      // Create anti-cheat session for this game
      stackState.antiCheatSession = AntiCheat.createSession('stack_duel', match.id, currentUser.id);

      if (btn) {
        btn.style.display = "none";
      }

      try {
        const oppId = slot === "player1" ? match.player2_id : match.player1_id;
        if (oppId) {
          const { data: oppProfile, error: oppError } = await supabaseClient
            .from("profiles")
            .select("username")
            .eq("id", oppId)
            .maybeSingle();
          if (!oppError && oppProfile) {
            stackState.opponentName = oppProfile.username || "Unknown player";
          }
        }
      } catch (e) {
        console.error("Failed to load opponent for Stack wager banner", e);
      }

      // Start a fresh run for this wager via hidden restart button
      const stackRestartHidden = document.getElementById("stack-restart-hidden");
      if (stackRestartHidden) {
        stackRestartHidden.click();
      }

      const resultEl = document.getElementById("stack-wager-result");
      if (resultEl) {
        const modeLabel = `$${cashEntry.toFixed(2)} cash`;
        if (slot === "player2") {
          resultEl.textContent = `Match found (${modeLabel})! Finish your run to record your score.`;
        } else {
          resultEl.textContent = `Match created (${modeLabel}). Finish your run to record your score.`;
        }
      }
      
      // Show Provably Fair badge
      const pfEl = document.getElementById("stack-provably-fair");
      if (pfEl && stackState.serverSeedHash) {
        pfEl.style.display = "block";
        pfEl.innerHTML = renderProvablyFairBadge(stackState.serverSeedHash, true);
        pfEl.onclick = () => window.showProvablyFairInfo(stackState.serverSeedHash, null, stackState.matchId);
      }
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to start wager match.");
  } finally {
    if (btn && !(stackState && stackState.inWager)) {
      btn.disabled = false;
    }
  }
}

async function handleStackGameOver() {
  if (
    !supabaseClient ||
    !currentUser ||
    !stackState?.inWager ||
    !stackState.matchId ||
    !stackState.playerSlot
  ) {
    return;
  }

  try {
    await submitMatchScore(stackState.matchId, stackState.playerSlot, stackState.score);
    const resultEl = document.getElementById("stack-wager-result");
    if (resultEl) {
      resultEl.textContent = `Wager run finished. Score submitted: ${stackState.score}. Awaiting results...`;
    }
    
    // Reveal Provably Fair seed
    if (stackState.provablyFairId) {
      await ProvablyFair.revealGame(stackState.provablyFairId);
      const pfEl = document.getElementById("stack-provably-fair");
      if (pfEl && stackState.serverSeedHash && stackState.serverSeed) {
        pfEl.innerHTML = renderProvablyFairBadge(stackState.serverSeedHash, true);
        pfEl.onclick = () => window.showProvablyFairInfo(stackState.serverSeedHash, stackState.serverSeed, stackState.matchId);
      }
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to submit wager score.");
  } finally {
    stackState.inWager = false;
    stackState.matchId = null;
    stackState.playerSlot = null;

    const btn = document.getElementById("stack-wager");
    if (btn) {
      btn.disabled = false;
      btn.style.display = "";
    }
    const toggleBtn = document.getElementById("stack-wager-toggle");
    if (toggleBtn) {
      toggleBtn.style.display = "";
    }
  }
}

// --- Chicken Run (single-player endless runner) ---

function mountChickenRun() {
  const root = document.getElementById("game-root");
  root.innerHTML = `
    <div class="chicken-layout">
      <div class="chicken-top">
        <div class="small-text">Distance</div>
        <div class="chicken-score" id="chicken-score">0</div>
        <button class="btn btn-secondary" id="chicken-wager">Start Tournament</button>
        <!-- Coin controls hidden for now -->
        <div id="chicken-coin-controls" style="display:none;">
          <div class="bet-controls">
            <button class="bet-btn" id="chicken-bet-down">-</button>
            <span class="bet-label" id="chicken-bet-label">Entry fee: 100</span>
            <button class="bet-btn" id="chicken-bet-up">+</button>
          </div>
          <div class="small-text" id="chicken-payout" style="margin-top:0.15rem; min-height:1em;"></div>
        </div>
        <!-- Cash entry controls -->
        <div id="chicken-cash-controls">
          <div class="bet-controls">
            <button class="bet-btn" id="chicken-cash-down">-</button>
            <span class="bet-label" id="chicken-cash-label">Entry: $1.00</span>
            <button class="bet-btn" id="chicken-cash-up">+</button>
          </div>
          <div class="small-text" id="chicken-cash-payout" style="margin-top:0.15rem; min-height:1em;">Win: $1.70</div>
        </div>
        <button id="chicken-restart-hidden" style="display:none;"></button>
      </div>
      <div class="card" style="margin-top:0.5rem; margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
          <h3 class="section-title" style="margin-bottom:0;">Top 5 - Chicken Run</h3>
          <button id="chicken-leaderboard-refresh" class="btn btn-secondary" style="padding:0.2rem 0.6rem;font-size:0.7rem;">Refresh</button>
        </div>
        <div id="chicken-leaderboard" class="small-text" style="margin-top:0.4rem; max-height:180px; overflow-y:auto;"></div>
      </div>
      <div class="small-text chicken-help">Press space or click to jump over obstacles. Survive as long as you can.</div>
      <canvas id="chicken-canvas" width="480" height="260" class="chicken-canvas"></canvas>
      <div class="small-text" id="chicken-wager-result" style="margin-top:0.25rem; min-height:1em;"></div>
      <div id="chicken-provably-fair" style="margin-top:0.5rem;display:none;"></div>
    </div>
  `;

  const canvas = document.getElementById("chicken-canvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("chicken-score");
  const wagerBtn = document.getElementById("chicken-wager");
  const chickenBetDown = document.getElementById("chicken-bet-down");
  const chickenBetUp = document.getElementById("chicken-bet-up");

  const groundY = canvas.height - 40;

  chickenState = {
    x: 60,
    y: groundY - 24,
    vy: 0,
    width: 26,
    height: 26,
    jumping: false,
    gravity: 0.6,
    jumpStrength: -13,
    obstacles: [],
    obstacleSpeed: 2.6,
    obstacleTimer: 0,
    obstacleInterval: 120,
    score: 0,
    alive: true,
    inWager: false,
    matchId: null,
    playerSlot: null,
    gameOverReported: false,
    wagerAmount: null,
    isCashMode: false,
    cashEntry: null,
    // Anti-cheat
    antiCheatSession: null,
  };

  function resetChicken() {
    chickenState.y = groundY - 24;
    chickenState.vy = 0;
    chickenState.obstacles = [];
    chickenState.obstacleSpeed = 2.6;
    chickenState.obstacleTimer = 0;
    chickenState.obstacleInterval = 120;
    chickenState.score = 0;
    chickenState.alive = true;
    chickenState.gameOverReported = false;
    scoreEl.textContent = "0";
    const resultEl = document.getElementById("chicken-wager-result");
    if (resultEl) {
      resultEl.textContent = "";
    }
  }

  function jump() {
    // Only allow play when a wager is active
    if (!chickenState.inWager) {
      const resultEl = document.getElementById("chicken-wager-result");
      if (resultEl) {
        resultEl.textContent = "Start a wager to play this game.";
      }
      return;
    }
    if (!chickenState.alive) return;
    if (chickenState.jumping) return;
    
    // Anti-cheat: Record action and check for bot behavior
    if (chickenState.antiCheatSession) {
      const result = AntiCheat.recordAction(chickenState.antiCheatSession, 'click');
      if (!result.allowed) {
        // Cheater detected - kill the chicken
        chickenState.alive = false;
        return;
      }
    }
    
    chickenState.vy = chickenState.jumpStrength;
    chickenState.jumping = true;
  }

  function spawnObstacle() {
    // Vary obstacle type/position based on current score so it gets more interesting over time
    const baseWidth = 26;
    const baseHeight = 28;

    // For the first few points, keep obstacles simple and on the ground
    if (chickenState.score < 8) {
      const width = baseWidth + Math.random() * 10;
      const height = baseHeight + Math.random() * 6;
      chickenState.obstacles.push({
        x: canvas.width + 10,
        y: groundY - height,
        width,
        height,
        passed: false,
      });
      return;
    }

    // After score 8, mix ground and floating obstacles
    const typeRand = Math.random();

    if (typeRand < 0.6) {
      // Ground obstacle
      const width = baseWidth + Math.random() * 14;
      const height = baseHeight + Math.random() * 10;
      chickenState.obstacles.push({
        x: canvas.width + 10,
        y: groundY - height,
        width,
        height,
        passed: false,
      });
    } else {
      // Floating obstacle you can safely run under
      const width = baseWidth + Math.random() * 14;
      const height = baseHeight + Math.random() * 6;
      const gapAboveChicken = 8 + Math.random() * 10; // vertical gap between chicken and obstacle bottom
      const y = groundY - chickenState.height - gapAboveChicken - height;

      chickenState.obstacles.push({
        x: canvas.width + 10,
        y,
        width,
        height,
        passed: false,
      });
    }
  }

  function updateChicken() {
    if (!chickenState.alive) return;

    // Physics
    chickenState.vy += chickenState.gravity;
    chickenState.y += chickenState.vy;

    if (chickenState.y + chickenState.height >= groundY) {
      chickenState.y = groundY - chickenState.height;
      chickenState.vy = 0;
      chickenState.jumping = false;
    }

    // Obstacles
    chickenState.obstacleTimer++;
    if (chickenState.obstacleTimer >= chickenState.obstacleInterval) {
      chickenState.obstacleTimer = 0;
      spawnObstacle();
      // Slightly speed up obstacles and reduce interval over time (gentler ramp)
      chickenState.obstacleSpeed = Math.min(chickenState.obstacleSpeed + 0.05, 6);
      chickenState.obstacleInterval = Math.max(70, chickenState.obstacleInterval - 0.5);
    }

    chickenState.obstacles.forEach((o) => {
      o.x -= chickenState.obstacleSpeed;
    });
    chickenState.obstacles = chickenState.obstacles.filter((o) => o.x + o.width > -20);

    // Score and collisions
    chickenState.obstacles.forEach((o) => {
      if (!o.passed && o.x + o.width < chickenState.x) {
        o.passed = true;
        chickenState.score += 1;
        scoreEl.textContent = String(chickenState.score);
      }

      const overlapX =
        chickenState.x < o.x + o.width && chickenState.x + chickenState.width > o.x;
      const overlapY =
        chickenState.y < o.y + o.height && chickenState.y + chickenState.height > o.y;
      if (overlapX && overlapY) {
        chickenState.alive = false;
        if (
          supabaseClient &&
          currentUser &&
          chickenState.inWager &&
          chickenState.matchId &&
          chickenState.playerSlot &&
          !chickenState.gameOverReported
        ) {
          chickenState.gameOverReported = true;
          handleChickenGameOver();
        }
      }
    });
  }

  function drawChicken() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Ground
    ctx.fillStyle = "#15803d";
    ctx.fillRect(0, groundY, canvas.width, canvas.height - groundY);

    // Obstacles
    ctx.fillStyle = "#f97316";
    chickenState.obstacles.forEach((o) => {
      ctx.fillRect(o.x, o.y, o.width, o.height);
    });

    // Chicken
    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(
      chickenState.x,
      chickenState.y,
      chickenState.width,
      chickenState.height
    );

    // Eye / beak for a little character vibe
    ctx.fillStyle = "#000000";
    ctx.fillRect(chickenState.x + 16, chickenState.y + 6, 4, 4);
    ctx.fillStyle = "#facc15";
    ctx.fillRect(chickenState.x + chickenState.width, chickenState.y + 10, 6, 4);

    // Active wager banner in HUD
    if (chickenState.inWager && chickenState.matchId) {
      const bannerAmount = chickenState.wagerAmount || getCurrentWagerAmount();
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(8, 8, 220, 32);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "11px system-ui";
      const oppLabel = chickenState.opponentName
        ? `vs ${chickenState.opponentName}`
        : "Matching opponent...";
      ctx.fillText(`${bannerAmount}-coin wager`, 14, 22);
      ctx.fillText(oppLabel, 14, 34);
    }

    // Game over overlay
    if (!chickenState.alive) {
      ctx.fillStyle = "rgba(15,23,42,0.7)";
      ctx.fillRect(0, canvas.height / 2 - 28, canvas.width, 56);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "16px system-ui";
      const text = "Hit an obstacle - press Restart";
      const textWidth = ctx.measureText(text).width;
      ctx.fillText(text, canvas.width / 2 - textWidth / 2, canvas.height / 2 + 4);
    }
  }

  function loop() {
    updateChicken();
    drawChicken();
    chickenAnimId = requestAnimationFrame(loop);
  }

  resetChicken();
  loop();

  function handleInput(e) {
    if (e.type === "keydown" && e.code === "Space") {
      e.preventDefault();
      jump();
    } else if (e.type === "mousedown") {
      jump();
    }
  }

  canvas.addEventListener("mousedown", handleInput);
  window.addEventListener("keydown", handleInput);

  const chickenRestartHidden = document.getElementById("chicken-restart-hidden");
  if (chickenRestartHidden) {
    chickenRestartHidden.addEventListener("click", () => {
      resetChicken();
    });
  }

   // Attach any pending wager join created before this mount.
  if (pendingChickenJoin && pendingChickenJoin.matchId && pendingChickenJoin.slot) {
    chickenState.inWager = true;
    chickenState.matchId = pendingChickenJoin.matchId;
    chickenState.playerSlot = pendingChickenJoin.slot;
    chickenState.gameOverReported = false;
    chickenState.isCashMode = pendingChickenJoin.isCashMode || false;
    chickenState.cashEntry = pendingChickenJoin.cashEntry || null;
    pendingChickenJoin = null;
    const resultEl = document.getElementById("chicken-wager-result");
    if (resultEl) {
      resultEl.textContent = "Match attached. Finish your run to record your score.";
    }
  }

  if (chickenState.inWager && wagerBtn) {
    wagerBtn.style.display = "none";
  }

  if (wagerBtn) {
    wagerBtn.addEventListener("click", handleChickenWagerClick);
  }

  if (chickenBetDown) {
    chickenBetDown.addEventListener("click", () => {
      decreaseWagerAmount();
    });
  }
  if (chickenBetUp) {
    chickenBetUp.addEventListener("click", () => {
      increaseWagerAmount();
    });
  }

  const chickenCashDown = document.getElementById("chicken-cash-down");
  const chickenCashUp = document.getElementById("chicken-cash-up");
  if (chickenCashDown) chickenCashDown.addEventListener("click", () => decreaseCashEntry());
  if (chickenCashUp) chickenCashUp.addEventListener("click", () => increaseCashEntry());

  // Load leaderboard for this game
  loadLeaderboardForGame("chicken-run", "chicken-leaderboard");

  const chickenLbRefresh = document.getElementById("chicken-leaderboard-refresh");
  if (chickenLbRefresh) {
    chickenLbRefresh.addEventListener("click", () => {
      loadLeaderboardForGame("chicken-run", "chicken-leaderboard");
    });
  }

  // Ensure wager labels reflect current amount
  updateWagerButtons();
  updateChickenCashUI();
}

async function handleChickenWagerClick() {
  if (!supabaseClient || !currentUser) {
    openAuthModal("login");
    return;
  }

  // Check if player is banned
  const canPlay = await checkBanBeforeGame('chicken_run');
  if (!canPlay) return;

  const btn = document.getElementById("chicken-wager");
  if (!btn) return;

  const cashEntry = getCurrentCashEntry();
  const now = Date.now();
  const last = lastWagerAtByGame["chicken-run"] || 0;
  if (now - last < WAGER_COOLDOWN_MS) {
    const remaining = Math.ceil((WAGER_COOLDOWN_MS - (now - last)) / 1000);
    alert(`Please wait ${remaining}s before starting another Chicken wager.`);
    return;
  }

  if (chickenState && chickenState.inWager) {
    btn.style.display = "none";
    alert("You already have an active wager run. Finish it before starting another.");
    return;
  }

  if ((currentUser.cash_balance ?? 0) < cashEntry) {
    alert(`Not enough cash for a $${cashEntry.toFixed(2)} entry. Please deposit more.`);
    return;
  }

  btn.disabled = true;
  btn.style.display = "none";

  try {
    const match = await createCashMatchForGame("chicken-run", cashEntry);
    if (!match) {
      throw new Error("Could not create cash match.");
    }
    const slot = match.player2_id === currentUser.id ? "player2" : "player1";

    pendingChickenJoin = { matchId: match.id, slot, isCashMode: true, cashEntry };

    await loadCurrentUser();
    lastWagerAtByGame["chicken-run"] = now;

    if (chickenState) {
      chickenState.inWager = true;
      chickenState.matchId = match.id;
      chickenState.playerSlot = slot;
      chickenState.gameOverReported = false;
      chickenState.opponentName = null;
      chickenState.wagerAmount = null;
      chickenState.isCashMode = true;
      chickenState.cashEntry = cashEntry;
      // Provably Fair data
      chickenState.provablyFairId = match.provablyFairId || null;
      chickenState.serverSeedHash = match.serverSeedHash || null;
      chickenState.serverSeed = match.serverSeed || null;
      // Create anti-cheat session for this game
      chickenState.antiCheatSession = AntiCheat.createSession('chicken_run', match.id, currentUser.id);

      if (btn) {
        btn.style.display = "none";
      }

      try {
        const oppId = slot === "player1" ? match.player2_id : match.player1_id;
        if (oppId) {
          const { data: oppProfile, error: oppError } = await supabaseClient
            .from("profiles")
            .select("username")
            .eq("id", oppId)
            .maybeSingle();
          if (!oppError && oppProfile) {
            chickenState.opponentName = oppProfile.username || "Unknown player";
          }
        }
      } catch (e) {
        console.error("Failed to load opponent for Chicken wager banner", e);
      }

      // Start a fresh run for this wager via hidden restart button
      const chickenRestartHidden = document.getElementById("chicken-restart-hidden");
      if (chickenRestartHidden) {
        chickenRestartHidden.click();
      }

      const modeLabel = `$${cashEntry.toFixed(2)} cash`;
      if (slot === "player2") {
        alert(`Joined a ${modeLabel} wager! Finish your run to record your score.`);
      } else {
        alert(`Created a ${modeLabel} wager! Finish your run to record your score.`);
      }
      
      // Show Provably Fair badge
      const pfEl = document.getElementById("chicken-provably-fair");
      if (pfEl && chickenState.serverSeedHash) {
        pfEl.style.display = "block";
        pfEl.innerHTML = renderProvablyFairBadge(chickenState.serverSeedHash, true);
        pfEl.onclick = () => window.showProvablyFairInfo(chickenState.serverSeedHash, null, chickenState.matchId);
      }
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to start Chicken wager.");
  } finally {
    if (btn && !(chickenState && chickenState.inWager)) {
      btn.disabled = false;
    }
  }
}

async function handleChickenGameOver() {
  if (
    !supabaseClient ||
    !currentUser ||
    !chickenState?.inWager ||
    !chickenState.matchId ||
    !chickenState.playerSlot
  ) {
    return;
  }

  try {
    await submitMatchScore(chickenState.matchId, chickenState.playerSlot, chickenState.score);
    const resultEl = document.getElementById("chicken-wager-result");
    if (resultEl) {
      resultEl.textContent = `Wager run finished. Distance submitted: ${chickenState.score}. Awaiting results...`;
    }
    
    // Reveal Provably Fair seed
    if (chickenState.provablyFairId) {
      await ProvablyFair.revealGame(chickenState.provablyFairId);
      const pfEl = document.getElementById("chicken-provably-fair");
      if (pfEl && chickenState.serverSeedHash && chickenState.serverSeed) {
        pfEl.innerHTML = renderProvablyFairBadge(chickenState.serverSeedHash, true);
        pfEl.onclick = () => window.showProvablyFairInfo(chickenState.serverSeedHash, chickenState.serverSeed, chickenState.matchId);
      }
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to submit Chicken wager score.");
  } finally {
    chickenState.inWager = false;
    chickenState.matchId = null;
    chickenState.playerSlot = null;
    chickenState.wagerAmount = null;
    chickenState.gameOverReported = false;

    const btn = document.getElementById("chicken-wager");
    if (btn) {
      btn.disabled = false;
      btn.style.display = "";
    }
    const toggleBtn = document.getElementById("chicken-wager-toggle");
    if (toggleBtn) {
      toggleBtn.style.display = "";
    }
  }
}

// --- Auth handlers ---
async function handleChangeEmailSubmit(event) {
  event.preventDefault();
  if (!supabaseClient || !currentUser) return;

  const form = event.target;
  const statusEl = document.getElementById("change-email-status");
  if (statusEl) statusEl.textContent = "";

  const currentPassword = form.current_password.value.trim();
  const newEmail = form.new_email.value.trim();
  if (!currentPassword || !newEmail) {
    if (statusEl) statusEl.textContent = "Enter your current password and a new email.";
    return;
  }

  try {
    const emailForLogin = currentUser.email;
    const { error: verifyError } = await supabaseClient.auth.signInWithPassword({
      email: emailForLogin,
      password: currentPassword,
    });
    if (verifyError) throw verifyError;

    const { error: authError } = await supabaseClient.auth.updateUser({ email: newEmail });
    if (authError) throw authError;

    const { data, error: profileError } = await supabaseClient
      .from("profiles")
      .update({
        email: newEmail,
      })
      .eq("id", currentUser.id)
      .select("email")
      .single();
    if (profileError) throw profileError;

    currentUser.email = data?.email || newEmail;
    render();
    form.current_password.value = "";
    if (statusEl) statusEl.textContent = "Email updated. Check your inbox if confirmation is required.";
  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = err.message || "Failed to update email.";
  }
}

async function handleChangePasswordSubmit(event) {
  event.preventDefault();
  if (!supabaseClient || !currentUser) return;

  const form = event.target;
  const statusEl = document.getElementById("change-password-status");
  if (statusEl) statusEl.textContent = "";

  const currentPassword = form.current_password.value.trim();
  const newPassword = form.new_password.value.trim();
  const confirmPassword = form.confirm_password.value.trim();
  if (!currentPassword || !newPassword || !confirmPassword) {
    if (statusEl) statusEl.textContent = "Enter your current password, a new password, and confirm it.";
    return;
  }

  if (newPassword !== confirmPassword) {
    if (statusEl) statusEl.textContent = "Passwords do not match.";
    return;
  }

  try {
    const emailForLogin = currentUser.email;
    const { error: verifyError } = await supabaseClient.auth.signInWithPassword({
      email: emailForLogin,
      password: currentPassword,
    });
    if (verifyError) throw verifyError;

    const { error: authError } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (authError) throw authError;

    render();
    form.current_password.value = "";
    form.new_password.value = "";
    form.confirm_password.value = "";
    if (statusEl) statusEl.textContent = "Password updated.";
  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = err.message || "Failed to update password.";
  }
}

async function handleSignup(event) {
  event.preventDefault();
  const form = event.target;
  const errorEl = document.getElementById("auth-error");
  errorEl.textContent = "";

  const email = form.email.value.trim();
  const password = form.password.value.trim();
  const usernameRaw = form.username.value.trim();
  const username = usernameRaw.toLowerCase();

  if (!email || !password || !username) {
    errorEl.textContent = "Please fill in all sign up fields.";
    return;
  }

  try {
    // 1) Check username availability via profiles table.
    const { data: existing, error: checkError } = await supabaseClient
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (checkError && checkError.code !== "PGRST116") {
      throw checkError;
    }

    if (existing) {
      errorEl.textContent = "Username is already taken.";
      return;
    }

    // 2) Sign up user
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
    });

    if (error) throw error;

    const user = data.user;
    if (!user) {
      errorEl.textContent = "Check your email to confirm your account.";
      return;
    }

    // 3) Create profile row with starting coins (also store email for username login)
    const { error: insertError } = await supabaseClient.from("profiles").insert({
      id: user.id,
      username,
      email,
      coin_balance: 1000,
    });

    if (insertError) throw insertError;

    await loadCurrentUser();
    closeAuthModal();
  } catch (err) {
    console.error(err);
    errorEl.textContent = err.message || "Sign up failed.";
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.target;
  const errorEl = document.getElementById("auth-error");
  errorEl.textContent = "";

  const identifier = form.email.value.trim();
  const password = form.password.value.trim();

  if (!identifier || !password) {
    errorEl.textContent = "Please enter email/username and password.";
    return;
  }

  try {
    let emailToUse = identifier;

    // If identifier does not look like an email, treat it as a username and
    // resolve the corresponding email from the profiles table.
    if (!identifier.includes("@")) {
      const usernameKey = identifier.toLowerCase();
      const { data: profile, error: profileError } = await supabaseClient
        .from("profiles")
        .select("email")
        .eq("username", usernameKey)
        .maybeSingle();

      if (profileError && profileError.code !== "PGRST116") {
        throw profileError;
      }

      if (!profile || !profile.email) {
        errorEl.textContent = "No account found for that username.";
        return;
      }

      emailToUse = profile.email;
    }

    const { error } = await supabaseClient.auth.signInWithPassword({
      email: emailToUse,
      password,
    });

    if (error) throw error;

    await loadCurrentUser();
    closeAuthModal();
  } catch (err) {
    console.error(err);
    errorEl.textContent = err.message || "Login failed.";
  }
}

async function handleLogout() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  currentUser = null;
  render();
}

async function loadCurrentUser() {
  if (!supabaseClient) {
    render();
    return;
  }

  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (!session?.user) {
    currentUser = null;
    render();
    return;
  }

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("id, username, email, coin_balance, cash_balance, kyc_status, last_daily_at")
    .eq("id", session.user.id)
    .single();

  if (error) {
    console.error(error);
    currentUser = null;
  } else {
    currentUser = profile;
  }

  // While actively inside a game (e.g. right after starting a wager), avoid
  // a full re-render: it tears down and rebuilds the entire game screen,
  // which kicks the browser out of fullscreen and reloads/restarts any
  // embedded game iframe. Just refresh the visible balance text instead.
  if (currentView === "game" && currentUser) {
    updateBalanceDisplay();
  } else {
    render();
  }
}

function getSpinInfo(user) {
  const last = user.last_daily_at ? new Date(user.last_daily_at).getTime() : null;
  const now = Date.now();

  if (!last || now - last >= SPIN_COOLDOWN_MS) {
    return { ready: true, remainingMs: 0, formattedRemaining: "0h 0m" };
  }

  const remainingMs = SPIN_COOLDOWN_MS - (now - last);
  const formattedRemaining = formatDuration(remainingMs);
  return { ready: false, remainingMs, formattedRemaining };
}

function formatDuration(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

// Builds a 25-slot arrangement from SPIN_WHEEL_PRIZE_GROUPS using a
// largest-remainder / fair round-robin scheduler: at each position we pick
// whichever prize group is furthest behind its ideal cumulative share so
// far. This interleaves ALL groups simultaneously (rather than placing one
// group fully before the next), producing a uniformly spread pattern around
// the whole wheel with no clumping.
function buildSpinWheelSlots() {
  const groups = SPIN_WHEEL_PRIZE_GROUPS.map((g) => ({ group: g, used: 0 }));
  const total = groups.reduce((sum, g) => sum + g.group.count, 0);
  const slots = [];

  for (let i = 0; i < total; i++) {
    let best = null;
    let bestScore = -Infinity;
    for (const entry of groups) {
      const idealCumulative = ((i + 1) * entry.group.count) / total;
      const score = idealCumulative - entry.used;
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    best.used += 1;
    slots.push(best.group);
  }

  return slots;
}

function openSpinWheelModal() {
  if (!supabaseClient || !currentUser) return;

  const spinInfo = getSpinInfo(currentUser);
  if (!spinInfo.ready) {
    alert(`Next free spin in ${spinInfo.formattedRemaining}.`);
    return;
  }

  const existing = document.getElementById("spin-wheel-modal-overlay");
  if (existing) existing.remove();

  const slots = buildSpinWheelSlots();
  const sliceDeg = 360 / slots.length;

  const gradientStops = slots
    .map((g, i) => `${g.color} ${(i * sliceDeg).toFixed(4)}deg ${((i + 1) * sliceDeg).toFixed(4)}deg`)
    .join(", ");

  const dividerLayer = `repeating-conic-gradient(from 0deg, rgba(15,23,42,0.55) 0deg 1.1deg, transparent 1.1deg ${sliceDeg}deg)`;

  const labelsHtml = slots
    .map((g, i) => {
      const centerAngle = i * sliceDeg + sliceDeg / 2;
      const isBottomHalf = centerAngle > 90 && centerAngle < 270;
      const flip = isBottomHalf ? 180 : 0;
      const labelClass = g.jackpot
        ? "spin-wheel-label spin-wheel-label-glow spin-wheel-jackpot"
        : "spin-wheel-label";
      // The jackpot's sparkle is a separate element positioned closer to the
      // hub (purely radial offset) so it never widens the amount text and
      // overlaps neighboring slice labels.
      const star = g.jackpot
        ? `<span class="spin-wheel-star" style="transform: translate(-50%, -50%) rotate(${flip}deg);">✨</span>`
        : "";
      return `
        <div class="spin-wheel-spoke" style="transform: rotate(${centerAngle}deg);">
          <span class="${labelClass}" style="color:${g.textColor}; transform: translate(-50%, -50%) rotate(${flip}deg);">${g.label}</span>
          ${star}
        </div>`;
    })
    .join("");

  const overlay = document.createElement("div");
  overlay.id = "spin-wheel-modal-overlay";
  overlay.className = "auth-modal-overlay";
  overlay.innerHTML = `
    <div class="auth-modal spin-wheel-modal">
      <div class="auth-modal-header">
        <div class="auth-modal-title">🎡 Free Spin</div>
        <button class="auth-modal-close" id="spin-wheel-modal-close">×</button>
      </div>
      <div class="spin-wheel-modal-body">
        <div class="spin-wheel-outer">
          <div class="spin-wheel-pointer"></div>
          <div
            class="spin-wheel-disc"
            id="spin-wheel-disc"
            style="transform: rotate(${spinWheelRotation}deg); background: conic-gradient(from 0deg, ${gradientStops}), ${dividerLayer};"
          >
            ${labelsHtml}
          </div>
          <div class="spin-wheel-sheen"></div>
          <div class="spin-wheel-hub">🎁</div>
        </div>
        <div class="spin-wheel-result" id="spin-wheel-result"></div>
        <button class="btn spin-wheel-cta" id="spin-wheel-go-btn">SPIN THE WHEEL</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => {
    if (spinInProgress) return;
    overlay.remove();
  };

  const closeBtn = document.getElementById("spin-wheel-modal-close");
  if (closeBtn) closeBtn.addEventListener("click", close);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const goBtn = document.getElementById("spin-wheel-go-btn");
  if (goBtn) {
    goBtn.addEventListener("click", () => handleSpinWheelGo(slots, sliceDeg));
  }
}

async function handleSpinWheelGo(slots, sliceDeg) {
  if (spinInProgress || !supabaseClient || !currentUser) return;

  const spinInfo = getSpinInfo(currentUser);
  if (!spinInfo.ready) {
    alert(`Next free spin in ${spinInfo.formattedRemaining}.`);
    return;
  }

  const goBtn = document.getElementById("spin-wheel-go-btn");
  const closeBtn = document.getElementById("spin-wheel-modal-close");
  const discEl = document.getElementById("spin-wheel-disc");
  const resultEl = document.getElementById("spin-wheel-result");
  if (!discEl) return;

  spinInProgress = true;
  if (goBtn) {
    goBtn.disabled = true;
    goBtn.textContent = "Spinning...";
  }
  if (closeBtn) closeBtn.disabled = true;
  if (resultEl) {
    resultEl.textContent = "";
    resultEl.className = "spin-wheel-result";
  }

  const winIndex = Math.floor(Math.random() * slots.length);
  const prize = slots[winIndex];

  try {
    const nowIso = new Date().toISOString();
    const newCashBalance = Number(((currentUser.cash_balance ?? 0) + prize.amount).toFixed(2));

    // Pay out immediately - the animation below is purely cosmetic playback
    // of a result that has already been recorded.
    const { data, error } = await supabaseClient
      .from("profiles")
      .update({
        cash_balance: newCashBalance,
        last_daily_at: nowIso, // reused column: tracks last free-spin claim time
      })
      .eq("id", currentUser.id)
      .select("cash_balance, last_daily_at")
      .single();

    if (error) throw error;

    currentUser.cash_balance = data.cash_balance;
    currentUser.last_daily_at = data.last_daily_at;
    updateBalanceDisplay();

    // Log the spin result for admin auditing (fire-and-forget; a failure
    // here shouldn't block the player from seeing their winnings).
    supabaseClient
      .from("spin_wheel_log")
      .insert({
        user_id: currentUser.id,
        username: currentUser.username,
        amount: prize.amount,
        is_jackpot: !!prize.jackpot,
      })
      .then(({ error: logError }) => {
        if (logError) console.error("Failed to log spin result", logError);
      });

    const centerAngle = winIndex * sliceDeg + sliceDeg / 2;
    const extraSpins = 6 + Math.floor(Math.random() * 3); // 6-8 full turns for effect
    const currentMod = ((spinWheelRotation % 360) + 360) % 360;
    const targetMod = (360 - centerAngle) % 360;
    let delta = targetMod - currentMod;
    if (delta < 0) delta += 360;
    spinWheelRotation += delta + extraSpins * 360;

    discEl.style.transform = `rotate(${spinWheelRotation}deg)`;

    setTimeout(() => {
      spinInProgress = false;
      if (goBtn) {
        goBtn.disabled = false;
        goBtn.textContent = "Spin again in 6h";
      }
      if (closeBtn) closeBtn.disabled = false;
      if (resultEl) {
        resultEl.textContent = `🎉 You won $${prize.amount.toFixed(2)}!`;
        resultEl.className = prize.jackpot ? "spin-wheel-result win-big" : "spin-wheel-result";
      }
      // Refresh the header banner/cooldown state behind the modal.
      render();
    }, 5200);
  } catch (err) {
    console.error(err);
    spinInProgress = false;
    if (goBtn) {
      goBtn.disabled = false;
      goBtn.textContent = "SPIN THE WHEEL";
    }
    if (closeBtn) closeBtn.disabled = false;
    alert(err.message || "Failed to spin the wheel. Please try again.");
  }
}

async function createMatchForGame(gameId, wager, maxPlayers = 2) {
  if (!supabaseClient || !currentUser) return null;

  const { data, error } = await supabaseClient
    .from("matches")
    .insert({
      game_id: gameId,
      wager,
      player1_id: currentUser.id,
      status: "open",
      max_players: maxPlayers,
    })
    .select("id, game_id, wager, status, player1_id, player2_id, player3_id, max_players")
    .single();

  if (error) {
    console.error(error);
    throw error;
  }

  // Create Provably Fair record for this match
  try {
    const pfGame = await ProvablyFair.createGame(gameId, data.id, currentUser.id);
    if (pfGame) {
      data.provablyFairId = pfGame.id;
      data.serverSeedHash = pfGame.serverSeedHash;
      data.serverSeed = pfGame.serverSeed;
      data.clientSeed = pfGame.clientSeed;
    }
  } catch (e) {
    console.error('Error creating provably fair record:', e);
  }

  return data;
}

async function createCashMatchForGame(gameId, cashEntry) {
  if (!supabaseClient || !currentUser) return null;

  try {
    const { data, error } = await supabaseClient.rpc("rpc_join_cash_match", {
      p_game_id: gameId,
      p_entry: cashEntry,
    });

    if (error) {
      console.error("rpc_join_cash_match error", error);
      throw error;
    }

    // Create Provably Fair record for cash match
    if (data && data.id) {
      try {
        const pfGame = await ProvablyFair.createGame(gameId, data.id, currentUser.id);
        if (pfGame) {
          data.provablyFairId = pfGame.id;
          data.serverSeedHash = pfGame.serverSeedHash;
          data.serverSeed = pfGame.serverSeed;
          data.clientSeed = pfGame.clientSeed;
        }
      } catch (e) {
        console.error('Error creating provably fair record:', e);
      }
    }

    return data;
  } catch (err) {
    console.error("Failed to create cash match", err);
    throw err;
  }
}

async function submitMatchScore(matchId, playerSlot, score) {
  if (!supabaseClient || !currentUser) return;

  // Support player1, player2, or player3
  let field = "player1_score";
  if (playerSlot === "player2") field = "player2_score";
  else if (playerSlot === "player3") field = "player3_score";

  const { error } = await supabaseClient
    .from("matches")
    .update({ [field]: score })
    .eq("id", matchId);

  if (error) {
    console.error(error);
    throw error;
  }

  function getWagerResultElementForGame(gameId) {
    if (gameId === "flappy-race") {
      return document.getElementById("flappy-wager-result");
    }
    if (gameId === "stack-duel") {
      return document.getElementById("stack-wager-result");
    }
    if (gameId === "reaction-duel") {
      return document.getElementById("reaction-wager-result");
    }
    if (gameId === "chicken-run") {
      return document.getElementById("chicken-wager-result");
    }
    if (gameId === "avoid-germs") {
      return document.getElementById("germs-wager-result");
    }
    if (gameId === "night-shift") {
      return document.getElementById("night-shift-wager-result");
    }
    if (gameId === "rolling-rush") {
      return document.getElementById("rolling-rush-wager-result");
    }
    return null;
  }

  // After saving this score, see if the match is now resolvable on the client.
  try {
    const { data: match, error: fetchError } = await supabaseClient
      .from("matches")
      .select(
        "id, game_id, wager, cash_entry, currency, status, player1_id, player2_id, player3_id, player1_score, player2_score, player3_score, max_players, winner_id, created_at"
      )
      .eq("id", matchId)
      .single();

    if (fetchError) {
      console.error(fetchError);
      return;
    }

    const nowMs = Date.now();
    const createdMs = match.created_at ? new Date(match.created_at).getTime() : null;

    // Check if all players have joined and submitted scores
    const maxPlayers = match.max_players || 2;
    const allPlayersJoined = match.player1_id && match.player2_id && 
                             (maxPlayers < 3 || match.player3_id);
    const allScoresSubmitted = match.player1_score !== null && 
                               match.player2_score !== null &&
                               (maxPlayers < 3 || match.player3_score !== null);
    
    if (!allPlayersJoined || !allScoresSubmitted) {
      // Still waiting for the other player. If the match is older than the timeout,
      // treat it as a tie and refund this player.
      if (createdMs && nowMs - createdMs >= MATCH_TIMEOUT_MS) {
        // Conditional update: only flip to "complete" if the match hasn't
        // already been resolved with a real winner by a concurrent client
        // (e.g. the opponent finished right around the same time). If 0
        // rows are affected, someone else already settled this match -
        // re-fetch and show the real outcome instead of a stale tie.
        const { data: updatedRows, error: updateError } = await supabaseClient
          .from("matches")
          .update({ status: "complete" })
          .eq("id", match.id)
          .neq("status", "complete")
          .is("winner_id", null)
          .select("id");

        if (updateError) {
          console.error("Failed to mark timed-out match complete", updateError);
        }

        if (!updateError && (!updatedRows || updatedRows.length === 0)) {
          // Someone else already resolved this match with a real result.
          return submitMatchScore(matchId, playerSlot, score);
        }

        // Use the same tie refund guard as loadAndRenderWagers so we only
        // refund this player once per device.
        const refundKey = `tie_refunded_${match.id}_${currentUser.id}`;
        const isCashMatch = match.currency === "CASH";
        const refundAmount = isCashMatch ? match.cash_entry : match.wager;
        try {
          const already = window.localStorage.getItem(refundKey);
          if (!already && refundAmount) {
            if (isCashMatch) {
              // Cash refund would need server-side handling - for now just mark as refunded
              // The server should handle this via a separate flow
            } else {
              await adjustCurrentUserCoins(refundAmount);
            }
            window.localStorage.setItem(refundKey, "1");
            await loadCurrentUser();
          }
        } catch (e) {
          console.error("Failed to process timeout tie refund", e);
        }

        const resultEl = getWagerResultElementForGame(match.game_id);
        if (resultEl) {
          resultEl.innerHTML = `<span style="color:#fbbf24;font-weight:bold;font-size:1.1rem;">⏰ TIMEOUT</span> <span style="color:#fcd34d;">Opponent didn't finish - Entry refunded</span>`;
        } else {
          alert("Opponent did not finish in time. Entry refunded.");
        }
      }
      return;
    }

    // If a winner is already recorded, the backend may already have settled
    // payouts via rpc_settle_match (which is idempotent). Just refresh coins
    // and show the outcome.
    if (match.winner_id) {
      const isWinner = match.winner_id === currentUser.id;

      // Either winner or loser balances may have changed on the backend,
      // so refresh the current user's profile regardless.
      await loadCurrentUser();

      const isCashMatch = match.currency === "CASH";
      const entryAmount = isCashMatch ? match.cash_entry : match.wager;
      const playerCount = match.max_players || 2;
      const total = entryAmount * playerCount;
      const fee = isCashMatch ? (total * 0.15) : Math.round(total * 0.15);
      const prize = total - fee;

      const resultEl = getWagerResultElementForGame(match.game_id);
      if (resultEl) {
        if (!match.winner_id) {
          resultEl.innerHTML = `<span style="color:#fbbf24;font-weight:bold;font-size:1.1rem;">🤝 TIE GAME!</span> <span style="color:#fcd34d;">Entry refunded</span>`;
        } else if (isWinner) {
          const prizeLabel = isCashMatch ? `$${prize.toFixed(2)}` : `${prize} coins`;
          resultEl.innerHTML = `<span style="color:#22c55e;font-weight:bold;font-size:1.1rem;">🏆 YOU WON!</span> <span style="color:#4ade80;">+${prizeLabel}</span>`;
        } else {
          const lossLabel = isCashMatch ? `$${entryAmount.toFixed(2)}` : `${entryAmount} coins`;
          resultEl.innerHTML = `<span style="color:#ef4444;font-weight:bold;font-size:1.1rem;">😢 YOU LOST</span> <span style="color:#f87171;">-${lossLabel}</span>`;
        }
      }

      return;
    }

    let winnerId = null;
    let loserId = null;

    // Determine winner based on scores (supports 2 or 3 players)
    const scores = [
      { id: match.player1_id, score: match.player1_score || 0 },
      { id: match.player2_id, score: match.player2_score || 0 },
    ];
    if (match.player3_id) {
      scores.push({ id: match.player3_id, score: match.player3_score || 0 });
    }
    
    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    
    // Winner is highest score, but only if no tie for first
    if (scores[0].score > scores[1].score) {
      winnerId = scores[0].id;
    }

    if (!winnerId) {
      // Tie: mark complete with no winner. Refunds are handled per-client in loadAndRenderWagers.
      await supabaseClient
        .from("matches")
        .update({ status: "complete" })
        .eq("id", match.id);
      const resultEl = getWagerResultElementForGame(match.game_id);
      if (resultEl) {
        resultEl.innerHTML = `<span style="color:#fbbf24;font-weight:bold;font-size:1.1rem;">🤝 TIE GAME!</span> <span style="color:#fcd34d;">Entry refunded</span>`;
      } else {
        alert("TIE GAME! Entry refunded.");
      }
      return;
    }

    // Record the winner on the match.
    await supabaseClient
      .from("matches")
      .update({
        status: "complete",
        winner_id: winnerId,
      })
      .eq("id", match.id);

    // Any client that completes the match now calls rpc_settle_match.
    // The SQL function ensures only participants can settle and uses
    // settled_at to avoid double-paying.
    try {
      await supabaseClient.rpc("rpc_settle_match", { p_match_id: match.id });
    } catch (e) {
      console.error("Failed to settle match via rpc_settle_match", e);
    }

    // Refresh the user's balance after potential settlement.
    await loadCurrentUser();

    const isCashMatch = match.currency === "CASH";
    const entryAmount = isCashMatch ? match.cash_entry : match.wager;
    const playerCount = match.max_players || 2;
    const total = entryAmount * playerCount;
    const fee = isCashMatch ? (total * 0.15) : Math.round(total * 0.15);
    const prize = total - fee;

    if (winnerId === currentUser.id) {
      const resultEl = getWagerResultElementForGame(match.game_id);
      const prizeLabel = isCashMatch ? `$${prize.toFixed(2)}` : `${prize} coins`;
      if (resultEl) {
        resultEl.innerHTML = `<span style="color:#22c55e;font-weight:bold;font-size:1.1rem;">🏆 YOU WON!</span> <span style="color:#4ade80;">+${prizeLabel}</span>`;
      } else {
        alert(`YOU WON! Prize: ${prizeLabel}`);
      }
    } else if (loserId === currentUser.id) {
      // Loser already paid entry on start; no further changes.
      const resultEl = getWagerResultElementForGame(match.game_id);
      const lossLabel = isCashMatch ? `$${entryAmount.toFixed(2)}` : `${entryAmount} coins`;
      if (resultEl) {
        resultEl.innerHTML = `<span style="color:#ef4444;font-weight:bold;font-size:1.1rem;">😢 YOU LOST</span> <span style="color:#f87171;">-${lossLabel}</span>`;
      } else {
        alert(`YOU LOST your ${lossLabel} entry fee.`);
      }
    }
  } catch (e) {
    console.error(e);
  }
}

async function adjustCurrentUserCoins(delta) {
  if (!supabaseClient || !currentUser || !delta) return;

  const { data, error } = await supabaseClient
    .from("profiles")
    .update({ coin_balance: (currentUser.coin_balance ?? 0) + delta })
    .eq("id", currentUser.id)
    .select("coin_balance")
    .single();

  if (error) {
    console.error(error);
    throw error;
  }

  currentUser.coin_balance = data.coin_balance;
  render();
}

// Same as above but doesn't trigger render() - use when you need to preserve current UI state
async function adjustCurrentUserCoinsNoRender(delta) {
  if (!supabaseClient || !currentUser || !delta) return;

  const { data, error } = await supabaseClient
    .from("profiles")
    .update({ coin_balance: (currentUser.coin_balance ?? 0) + delta })
    .eq("id", currentUser.id)
    .select("coin_balance")
    .single();

  if (error) {
    console.error(error);
    throw error;
  }

  currentUser.coin_balance = data.coin_balance;
  // Update header coin display directly
  const coinEl = document.querySelector('.header-coins');
  if (coinEl) coinEl.textContent = `${data.coin_balance.toLocaleString()} coins`;
}

async function findOrCreateFlappyMatch(wagerAmount) {
  if (!supabaseClient || !currentUser) return { match: null, slot: null };

  const maxPlayers = getFlappyPlayerCount();
  console.log('[Flappy] Looking for match with wager:', wagerAmount, 'maxPlayers:', maxPlayers);

  // 1) Try to join an existing open match with same wager and max_players
  // For 3-player matches, we need to find matches that have empty slots (player2 or player3)
  const { data: openMatches, error: selectError } = await supabaseClient
    .from("matches")
    .select("id, game_id, wager, status, player1_id, player2_id, player3_id, max_players")
    .eq("game_id", "flappy-race")
    .eq("wager", wagerAmount)
    .eq("status", "open")
    .neq("player1_id", currentUser.id)
    .order("created_at", { ascending: true })
    .limit(10);

  console.log('[Flappy] Open matches found:', openMatches?.length || 0, openMatches);

  if (selectError && selectError.code !== "PGRST116") {
    console.error('[Flappy] Select error:', selectError);
    throw selectError;
  }

  // Find a match we can join (has an empty slot AND matching max_players)
  let matchToJoin = null;
  let slotToFill = null;
  
  for (const m of (openMatches || [])) {
    const matchMaxPlayers = m.max_players || 2;
    console.log('[Flappy] Checking match:', m.id, 'max_players:', matchMaxPlayers, 'p1:', m.player1_id, 'p2:', m.player2_id, 'p3:', m.player3_id);
    
    // Skip if max_players doesn't match what we're looking for
    if (matchMaxPlayers !== maxPlayers) continue;
    
    // Skip if we're already in this match
    if (m.player2_id === currentUser.id || m.player3_id === currentUser.id) continue;
    
    if (!m.player2_id) {
      matchToJoin = m;
      slotToFill = "player2";
      console.log('[Flappy] Found slot: player2 in match', m.id);
      break;
    } else if (maxPlayers === 3 && !m.player3_id) {
      matchToJoin = m;
      slotToFill = "player3";
      console.log('[Flappy] Found slot: player3 in match', m.id);
      break;
    }
  }

  if (!matchToJoin) {
    console.log('[Flappy] No suitable match found, will create new one');
  }

  if (matchToJoin && slotToFill) {
    // Use the MATCH's max_players, not the local selector
    const matchMaxPlayers = matchToJoin.max_players || 2;
    
    // Determine if this completes the match (all players joined)
    const willBeComplete = (slotToFill === "player2" && matchMaxPlayers === 2) ||
                           (slotToFill === "player3" && matchMaxPlayers === 3);
    const newStatus = willBeComplete ? "in_progress" : "open";
    console.log('[Flappy] Joining match', matchToJoin.id, 'as', slotToFill, 'matchMaxPlayers:', matchMaxPlayers, 'newStatus:', newStatus);
    
    const updateData = { [slotToFill + "_id"]: currentUser.id, status: newStatus };
    
    const { data: joinedRows, error: updateError } = await supabaseClient
      .from("matches")
      .update(updateData)
      .eq("id", matchToJoin.id)
      .select("id, game_id, wager, status, player1_id, player2_id, player3_id, max_players");

    if (updateError) {
      console.error(updateError);
      throw updateError;
    }

    const joined = joinedRows && joinedRows.length > 0 ? joinedRows[0] : matchToJoin;
    
    // Fetch existing provably fair data for this match
    const pfData = await ProvablyFair.getVerificationData(joined.id);
    if (pfData) {
      joined.provablyFairId = pfData.id;
      joined.serverSeedHash = pfData.server_seed_hash;
      joined.serverSeed = pfData.server_seed;
    }
    
    return { match: joined, slot: slotToFill };
  }

  // 2) Otherwise create a new match as player1
  console.log('[Flappy] Creating new match with maxPlayers:', maxPlayers);
  const created = await createMatchForGame("flappy-race", wagerAmount, maxPlayers);
  console.log('[Flappy] Created match:', created?.id, 'max_players:', created?.max_players);
  return { match: created, slot: "player1" };
}

async function findOrCreateStackMatch(wagerAmount) {
  if (!supabaseClient || !currentUser) return { match: null, slot: null };

  const { data: openMatches, error: selectError } = await supabaseClient
    .from("matches")
    .select("id, game_id, wager, status, player1_id, player2_id")
    .eq("game_id", "stack-duel")
    .eq("wager", wagerAmount)
    .eq("status", "open")
    .is("player2_id", null)
    .neq("player1_id", currentUser.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (selectError && selectError.code !== "PGRST116") {
    console.error(selectError);
    throw selectError;
  }

  const openMatch = openMatches && openMatches.length > 0 ? openMatches[0] : null;

  if (openMatch) {
    const { data: joinedRows, error: updateError } = await supabaseClient
      .from("matches")
      .update({ player2_id: currentUser.id, status: "in_progress" })
      .eq("id", openMatch.id)
      .select("id, game_id, wager, status, player1_id, player2_id");

    if (updateError) {
      console.error(updateError);
      throw updateError;
    }

    const joined = joinedRows && joinedRows.length > 0 ? joinedRows[0] : openMatch;
    
    // Fetch existing provably fair data for this match
    const pfData = await ProvablyFair.getVerificationData(joined.id);
    if (pfData) {
      joined.provablyFairId = pfData.id;
      joined.serverSeedHash = pfData.server_seed_hash;
      joined.serverSeed = pfData.server_seed;
    }
    
    return { match: joined, slot: "player2" };
  }

  const created = await createMatchForGame("stack-duel", wagerAmount);
  return { match: created, slot: "player1" };
}

async function findOrCreateReactionMatch(wagerAmount) {
  if (!supabaseClient || !currentUser) return { match: null, slot: null };

  const { data: openMatches, error: selectError } = await supabaseClient
    .from("matches")
    .select("id, game_id, wager, status, player1_id, player2_id")
    .eq("game_id", "reaction-duel")
    .eq("wager", wagerAmount)
    .eq("status", "open")
    .is("player2_id", null)
    .neq("player1_id", currentUser.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (selectError && selectError.code !== "PGRST116") {
    console.error(selectError);
    throw selectError;
  }

  const openMatch = openMatches && openMatches.length > 0 ? openMatches[0] : null;

  if (openMatch) {
    const { data: joinedRows, error: updateError } = await supabaseClient
      .from("matches")
      .update({ player2_id: currentUser.id, status: "in_progress" })
      .eq("id", openMatch.id)
      .select("id, game_id, wager, status, player1_id, player2_id");

    if (updateError) {
      console.error(updateError);
      throw updateError;
    }

    const joined = joinedRows && joinedRows.length > 0 ? joinedRows[0] : openMatch;
    
    // Fetch existing provably fair data for this match
    const pfData = await ProvablyFair.getVerificationData(joined.id);
    if (pfData) {
      joined.provablyFairId = pfData.id;
      joined.serverSeedHash = pfData.server_seed_hash;
      joined.serverSeed = pfData.server_seed;
    }
    
    return { match: joined, slot: "player2" };
  }

  const created = await createMatchForGame("reaction-duel", wagerAmount);
  return { match: created, slot: "player1" };
}

async function findOrCreateChickenMatch(wagerAmount) {
  if (!supabaseClient || !currentUser) return { match: null, slot: null };

  const { data: openMatches, error: selectError } = await supabaseClient
    .from("matches")
    .select("id, game_id, wager, status, player1_id, player2_id")
    .eq("game_id", "chicken-run")
    .eq("wager", wagerAmount)
    .eq("status", "open")
    .is("player2_id", null)
    .neq("player1_id", currentUser.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (selectError && selectError.code !== "PGRST116") {
    console.error(selectError);
    throw selectError;
  }

  const openMatch = openMatches && openMatches.length > 0 ? openMatches[0] : null;

  if (openMatch) {
    const { data: joinedRows, error: updateError } = await supabaseClient
      .from("matches")
      .update({ player2_id: currentUser.id, status: "in_progress" })
      .eq("id", openMatch.id)
      .select("id, game_id, wager, status, player1_id, player2_id");

    if (updateError) {
      console.error(updateError);
      throw updateError;
    }

    const joined = joinedRows && joinedRows.length > 0 ? joinedRows[0] : openMatch;
    
    // Fetch existing provably fair data for this match
    const pfData = await ProvablyFair.getVerificationData(joined.id);
    if (pfData) {
      joined.provablyFairId = pfData.id;
      joined.serverSeedHash = pfData.server_seed_hash;
      joined.serverSeed = pfData.server_seed;
    }
    
    return { match: joined, slot: "player2" };
  }

  const created = await createMatchForGame("chicken-run", wagerAmount);
  return { match: created, slot: "player1" };
}

async function findOrCreateGermsMatch(wagerAmount) {
  if (!supabaseClient || !currentUser) return { match: null, slot: null };

  const { data: openMatches, error: selectError } = await supabaseClient
    .from("matches")
    .select("id, game_id, wager, status, player1_id, player2_id")
    .eq("game_id", "avoid-germs")
    .eq("wager", wagerAmount)
    .eq("status", "open")
    .is("player2_id", null)
    .neq("player1_id", currentUser.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (selectError && selectError.code !== "PGRST116") {
    console.error(selectError);
    throw selectError;
  }

  const openMatch = openMatches && openMatches.length > 0 ? openMatches[0] : null;

  if (openMatch) {
    const { data: joinedRows, error: updateError } = await supabaseClient
      .from("matches")
      .update({ player2_id: currentUser.id, status: "in_progress" })
      .eq("id", openMatch.id)
      .select("id, game_id, wager, status, player1_id, player2_id");

    if (updateError) {
      console.error(updateError);
      throw updateError;
    }

    const joined = joinedRows && joinedRows.length > 0 ? joinedRows[0] : openMatch;

    // Fetch existing provably fair data for this match
    const pfData = await ProvablyFair.getVerificationData(joined.id);
    if (pfData) {
      joined.provablyFairId = pfData.id;
      joined.serverSeedHash = pfData.server_seed_hash;
      joined.serverSeed = pfData.server_seed;
    }

    return { match: joined, slot: "player2" };
  }

  const created = await createMatchForGame("avoid-germs", wagerAmount);
  return { match: created, slot: "player1" };
}

async function loadAndRenderWagers() {
  const container = document.getElementById("wagers-content");
  if (!container || !supabaseClient || !currentUser) return;

  container.textContent = "Loading...";

  // Load regular matches
  const { data, error } = await supabaseClient
    .from("matches")
    .select(
      "id, game_id, wager, cash_entry, currency, status, winner_id, player1_id, player2_id, player1_score, player2_score, created_at"
    )
    // Only show matches this user participated in
    .or(`player1_id.eq.${currentUser.id},player2_id.eq.${currentUser.id}`)
    .order("created_at", { ascending: false })
    .limit(20);
  
  // Load Speed Dash races - get lobby IDs from race_lobbies where user participated
  const { data: myRaces, error: racesErr } = await supabaseClient
    .from("race_participants")
    .select("lobby_id, position, lane")
    .eq("player_id", currentUser.id)
    .limit(50);
  
  console.log('[Wagers] Race participants found:', myRaces?.length, 'error:', racesErr);
  
  let speedDashData = [];
  if (myRaces && myRaces.length > 0) {
    // Get unique lobby IDs
    const lobbyIds = [...new Set(myRaces.map(r => r.lobby_id))];
    console.log('[Wagers] Unique lobby IDs:', lobbyIds.length, lobbyIds);
    const { data: lobbies } = await supabaseClient
      .from("race_lobbies")
      .select("id, distance, entry_fee, currency, status, winner_id, created_at")
      .in("id", lobbyIds)
      .order("created_at", { ascending: false });
    
    if (lobbies) {
      // Get all participants for these lobbies
      const { data: allParticipants } = await supabaseClient
        .from("race_participants")
        .select("lobby_id, player_id, position, username")
        .in("lobby_id", lobbyIds);
      
      speedDashData = lobbies.map(lobby => {
        const participants = allParticipants?.filter(p => p.lobby_id === lobby.id) || [];
        const myParticipant = participants.find(p => p.player_id === currentUser.id);
        const opponents = participants.filter(p => p.player_id !== currentUser.id);
        
        // Build opponent names string (handles 1, 2, or more opponents)
        const oppNames = opponents.map(o => o.username || 'Player').join(' & ');
        
        return {
          id: lobby.id,
          game_id: "speed-dash",
          wager: lobby.currency === "COIN" ? lobby.entry_fee : 0,
          cash_entry: lobby.currency === "CASH" ? lobby.entry_fee : 0,
          currency: lobby.currency,
          status: lobby.status === "finished" ? "complete" : lobby.status,
          winner_id: lobby.winner_id,
          player1_id: currentUser.id,
          player2_id: opponents[0]?.player_id || null,
          player1_score: myParticipant?.position || 0,
          player2_score: opponents[0]?.position || 0,
          created_at: lobby.created_at,
          _isSpeedDash: true,
          _oppUsername: oppNames || null,
          _playerCount: participants.length
        };
      });
    }
  }
  
  // Combine and sort by date
  const allMatches = [...(data || []), ...speedDashData]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 30);

  if (error) {
    console.error(error);
    container.textContent = "Failed to load wagers.";
    return;
  }

  if (allMatches.length === 0) {
    container.textContent = "No wagers yet. Play a wager game to see it here.";
    return;
  }

  // Handle per-client tie refunds (winner payouts handled by rpc_settle_match).
  // Only process regular matches (not speed dash)
  for (const m of (data || [])) {
    const isParticipant =
      m.player1_id === currentUser.id || m.player2_id === currentUser.id;
    if (!isParticipant) continue;

    // Proactively resolve matches that have sat unresolved (nobody joined,
    // or an opponent joined but never finished their run) past the timeout
    // window, instead of waiting for someone to call submitMatchScore.
    if (m.status !== "complete") {
      const createdMs = m.created_at ? new Date(m.created_at).getTime() : null;
      const isStale = createdMs && Date.now() - createdMs >= MATCH_TIMEOUT_MS;
      if (isStale) {
        try {
          // Conditional update: only flip to "complete" if it hasn't
          // already been resolved with a real winner by a concurrent client.
          const { data: updatedRows, error: updateError } = await supabaseClient
            .from("matches")
            .update({ status: "complete" })
            .eq("id", m.id)
            .neq("status", "complete")
            .is("winner_id", null)
            .select("id, status, winner_id");

          if (updateError) {
            console.error("Failed to auto-resolve stale match", updateError);
          } else if (updatedRows && updatedRows.length > 0) {
            m.status = "complete";
          } else {
            // Already resolved (with or without a winner) by someone else;
            // refresh our local copy so the rest of this loop/render uses
            // the real outcome instead of stale "pending" data.
            const { data: freshMatch } = await supabaseClient
              .from("matches")
              .select("status, winner_id")
              .eq("id", m.id)
              .single();
            if (freshMatch) {
              m.status = freshMatch.status;
              m.winner_id = freshMatch.winner_id;
            }
          }
        } catch (e) {
          console.error("Failed to auto-resolve stale match", e);
        }
      }
    }

    if (m.status === "complete" && !m.winner_id) {
      const isCashMatch = m.currency === "CASH";
      const refundAmount = isCashMatch ? m.cash_entry : m.wager;
      const refundKey = `tie_refunded_${m.id}_${currentUser.id}`;
      try {
        const already = window.localStorage.getItem(refundKey);
        if (!already && refundAmount) {
          if (isCashMatch) {
            // Cash refund would need server-side handling - for now just mark as refunded
            // The server should handle this via a separate flow
          } else {
            await adjustCurrentUserCoins(refundAmount);
          }
          window.localStorage.setItem(refundKey, "1");
        }
      } catch (e) {
        console.error("Failed to process tie refund", e);
      }
    }
  }

  // Load fees_ledger rows for these matches so we can compute net +/- per match.
  // Only for regular matches (not speed dash)
  const regularMatchIds = (data || []).map((m) => m.id);
  let ledgerByMatchId = {};
  if (regularMatchIds.length > 0) {
    try {
      const { data: ledgerRows, error: ledgerError } = await supabaseClient
        .from("fees_ledger")
        .select(
          "match_id, total_entry, fee_amount, payout_amount, winner_id, created_at, currency"
        )
        .in("match_id", regularMatchIds);

      if (!ledgerError && ledgerRows) {
        ledgerByMatchId = Object.fromEntries(
          ledgerRows.map((r) => [r.match_id, r])
        );
      }
    } catch (e) {
      console.error("Failed to load fees_ledger for wagers", e);
    }
  }

  // Load usernames for opponents so we can show who you played against.
  const idSet = new Set();
  for (const m of allMatches) {
    if (m.player1_id) idSet.add(m.player1_id);
    if (m.player2_id) idSet.add(m.player2_id);
  }

  const allIds = Array.from(idSet);
  let profilesById = {};
  if (allIds.length > 0) {
    try {
      const { data: profiles, error: profilesError } = await supabaseClient
        .from("profiles")
        .select("id, username")
        .in("id", allIds);

      if (!profilesError && profiles) {
        profilesById = Object.fromEntries(
          profiles.map((p) => [p.id, p.username || "Unknown"])
        );
      }
    } catch (e) {
      console.error("Failed to load opponent usernames", e);
    }
  }

  // Enrich matches with net amounts and basic stats
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let totalCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let tieCount = 0;
  let netAll = 0;
  let net24h = 0;

  // Load provably fair data for all matches
  const allMatchIds = allMatches.map(m => m.id);
  let provablyFairByGameId = {};
  if (allMatchIds.length > 0) {
    try {
      const { data: pfData } = await supabaseClient
        .from("provably_fair_games")
        .select("game_id, server_seed_hash, server_seed, is_revealed")
        .in("game_id", allMatchIds);
      
      if (pfData) {
        provablyFairByGameId = Object.fromEntries(
          pfData.map(pf => [pf.game_id, pf])
        );
      }
    } catch (e) {
      console.error("Failed to load provably fair data", e);
    }
  }

  const enriched = allMatches.map((m) => {
    const game = gameCards.find((g) => g.id === m.game_id);
    const title = game ? game.title : (m.game_id === "speed-dash" ? "Speed Dash" : m.game_id);

    const isPlayer1 = m.player1_id === currentUser.id;
    const oppId = isPlayer1 ? m.player2_id : m.player1_id;
    // For speed dash, use the stored opponent username
    const oppName = m._oppUsername 
      ? m._oppUsername 
      : (oppId ? profilesById[oppId] || "Unknown player" : "Waiting for opponent");

    let statusLabel = m.status;
    let statusKey = "pending";
    let isWin = false;
    let isLoss = false;
    let isTie = false;

    if (m.status === "open" && !m.player2_id) {
      statusLabel = "Pending opponent";
      statusKey = "pending";
    } else if (m.status !== "complete") {
      statusLabel = "In progress";
      statusKey = "inprogress";
    } else if (m.status === "complete") {
      if (!m.winner_id) {
        statusLabel = "Completed - tie";
        statusKey = "tie";
        isTie = true;
      } else if (m.winner_id === currentUser.id) {
        statusLabel = "Completed - you won";
        statusKey = "win";
        isWin = true;
      } else {
        statusLabel = "Completed - you lost";
        statusKey = "loss";
        isLoss = true;
      }
    }

    const myScore = isPlayer1 ? m.player1_score : m.player2_score;
    const oppScore = isPlayer1 ? m.player2_score : m.player1_score;
    const scoreLabel =
      myScore === null && oppScore === null
        ? "Scores: -- / --"
        : `Scores: you ${myScore ?? "-"} vs opp ${oppScore ?? "-"}`;

    // Compute net relative to before the match (for summaries)
    // and a separate displayAmount used in the UI.
    const isCash = m.currency === "CASH";
    const entryAmount = isCash ? (m.cash_entry || 0) : (m.wager || 0);

    let net = 0;
    let displayAmount = 0;
    const ledger = ledgerByMatchId[m.id];

    if (m.status === "complete" && ledger && ledger.winner_id && !isTie) {
      if (ledger.winner_id === currentUser.id) {
        // Winner: paid entry, then received payout_amount
        const payout = ledger.payout_amount || 0;
        net = payout - entryAmount; // profit for summaries
        displayAmount = payout; // show total payout in UI
      } else {
        // Loser: only lost the entry fee
        net = -entryAmount;
        displayAmount = -entryAmount;
      }
    } else if (m.status === "complete" && isTie) {
      net = 0;
      displayAmount = 0;
    } else if (m.status === "complete" && !ledger) {
      // Fallback for older matches without ledger rows
      const total = entryAmount * 2;
      const fee = isCash ? (total * 0.15) : Math.round(total * 0.15);
      const prize = total - fee;
      if (isWin) {
        net = prize - entryAmount;
        displayAmount = prize;
      } else if (isLoss) {
        net = -entryAmount;
        displayAmount = -entryAmount;
      }
    } else if (m.status === "open" || m.status === "active") {
      // Pending match: show entry amount as pending
      displayAmount = -entryAmount; // negative because it's been paid
    }

    const createdAt = new Date(m.created_at);
    const inLast24h = createdAt >= dayAgo;

    // Update aggregates only for matches that are part of the new
    // settlement/fee system: normally those with a fees_ledger row or ties.
    // However, if this user lost a match and cannot see the ledger row due
    // to RLS, we still want to count their loss (net is already -wager).
    const hasLedger = !!ledger;
    const shouldCountInTotals = hasLedger || isTie || (isLoss && !hasLedger);
    if (m.status === "complete" && shouldCountInTotals) {
      totalCount += 1;
      if (isWin) winCount += 1;
      else if (isLoss) lossCount += 1;
      else if (isTie) tieCount += 1;

      netAll += net;
      if (inLast24h) {
        net24h += net;
      }
    }

    // Get provably fair data for this match
    const pfData = provablyFairByGameId[m.id];
    
    return {
      match: m,
      title,
      oppName,
      statusLabel,
      statusKey,
      scoreLabel,
      net,
      displayAmount,
      isWin,
      isLoss,
      isTie,
      createdAt,
      isCash,
      entryAmount,
      provablyFair: pfData || null,
    };
  });

  // Apply filter for the list view
  const filtered = enriched.filter((row) => {
    if (wagersFilter === "wins") return row.isWin;
    if (wagersFilter === "losses") return row.isLoss;
    if (wagersFilter === "today") {
      const todayLocal = new Date();
      todayLocal.setHours(0, 0, 0, 0);
      return row.createdAt >= todayLocal;
    }
    return true; // all
  });

  const rowsHtml = filtered
    .map((row) => {
      const { match: m } = row;

      const amt = row.displayAmount ?? row.net;
      const isPending = m.status === "open" || m.status === "active";

      let amountLabel;
      let amountClass;
      
      if (row.isCash) {
        // Cash formatting
        if (isPending) {
          amountLabel = `-$${row.entryAmount.toFixed(2)} entry`;
          amountClass = "wager-net-pending";
        } else if (amt === 0) {
          amountLabel = "$0.00";
          amountClass = "wager-net-zero";
        } else if (amt > 0) {
          amountLabel = `+$${amt.toFixed(2)}`;
          amountClass = "wager-net-positive";
        } else {
          amountLabel = `-$${Math.abs(amt).toFixed(2)}`;
          amountClass = "wager-net-negative";
        }
      } else {
        // Coin formatting
        if (isPending) {
          amountLabel = `-${row.entryAmount} entry`;
          amountClass = "wager-net-pending";
        } else if (amt === 0) {
          amountLabel = "0 coins";
          amountClass = "wager-net-zero";
        } else if (amt > 0) {
          amountLabel = `+${amt} coins`;
          amountClass = "wager-net-positive";
        } else {
          amountLabel = `${amt} coins`;
          amountClass = "wager-net-negative";
        }
      }

      // Generate verify button if provably fair data exists
      const verifyBtn = row.provablyFair 
        ? `<button class="btn btn-secondary verify-pf-btn" data-match-id="${m.id}" data-hash="${row.provablyFair.server_seed_hash || ''}" data-seed="${row.provablyFair.is_revealed ? (row.provablyFair.server_seed || '') : ''}" style="padding:0.15rem 0.5rem;font-size:0.65rem;margin-top:0.3rem;">🔍 Verify</button>`
        : '';

      return `<div class="wager-row">
        <div class="wager-main">
          <div class="wager-title">${row.title}</div>
          <div class="wager-meta">
            <span class="wager-opponent">vs ${row.oppName}</span>
            <span class="wager-dot">•</span>
            <span class="wager-time">${row.createdAt.toLocaleString()}</span>
          </div>
          <div class="wager-scores small-text">${row.scoreLabel}</div>
        </div>
        <div class="wager-side">
          <div class="wager-amount ${amountClass}">${amountLabel}</div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.2rem;">
            <span class="status-pill status-${row.statusKey}">${row.statusLabel}</span>
            ${verifyBtn}
          </div>
        </div>
      </div>`;
    })
    .join("");

  container.innerHTML = rowsHtml;
  
  // Add click handlers for verify buttons
  container.querySelectorAll('.verify-pf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const matchId = btn.getAttribute('data-match-id');
      const hash = btn.getAttribute('data-hash');
      const seed = btn.getAttribute('data-seed');
      showProvablyFairInfo(hash, seed, matchId);
    });
  });
}

async function loadLeaderboardForGame(gameId, containerId) {
  if (!supabaseClient) return;

  const container = document.getElementById(containerId);
  if (!container) return;

  container.textContent = "Loading leaderboard...";

  try {
    const { data, error } = await supabaseClient
      .from("game_leaderboard")
      .select("username, best_score")
      .eq("game_id", gameId)
      .order("best_score", { ascending: false })
      .limit(5);

    if (error) {
      console.error(error);
      container.textContent = "Failed to load leaderboard.";
      return;
    }

    if (!data || !data.length) {
      container.textContent = "No scores yet. Be the first to set a record!";
      return;
    }

    container.innerHTML = data
      .map(
        (row, index) => `
          <div class="leaderboard-row" style="display:flex;justify-content:space-between;align-items:center;padding:0.15rem 0;font-size:0.8rem;">
            <span style="opacity:0.75;">#${index + 1}</span>
            <span style="flex:1;margin-left:0.35rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">@${row.username}</span>
            <span style="font-variant-numeric:tabular-nums;">${row.best_score}</span>
          </div>
        `
      )
      .join("");
  } catch (err) {
    console.error(err);
    container.textContent = "Failed to load leaderboard.";
  }
}

// --- Speed Dash (Live Race) ---
function mountSpeedDash() {
  const root = document.getElementById("game-root");
  if (!root) return;

  root.innerHTML = `
    <div id="speed-dash-container" style="width:100%;max-width:700px;margin:0 auto;">
      <div id="speed-dash-lobby" style="text-align:center;">
        <h3 style="margin-bottom:1rem;">Speed Dash</h3>
        <p class="small-text" style="margin-bottom:1rem;">Click fast to sprint! First to the finish line wins.</p>
        
        <!-- Mode toggle: Coins / Cash (coin option hidden for now) -->
        <div class="mode-toggle" style="display:none;justify-content:center;gap:0.25rem;margin-bottom:1rem;">
          <button class="btn btn-secondary" id="dash-mode-coin" style="padding:0.3rem 1rem;font-size:0.85rem;">Coins</button>
          <button class="btn btn-secondary active" id="dash-mode-cash" style="padding:0.3rem 1rem;font-size:0.85rem;">💵 Cash</button>
        </div>
        
        <div style="margin-bottom:1rem;display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
          <div>
            <label class="small-text">Distance:</label>
            <select id="dash-distance" style="margin-left:0.5rem;padding:0.25rem;">
              <option value="100">100m</option>
              <option value="200">200m</option>
              <option value="400">400m</option>
            </select>
          </div>
          <div>
            <label class="small-text">Players:</label>
            <select id="dash-players" style="margin-left:0.5rem;padding:0.25rem;">
              <option value="2">2 players</option>
              <option value="3">3 players</option>
            </select>
          </div>
        </div>
        
        <!-- Coin entry controls (hidden for now) -->
        <div id="dash-coin-controls" style="display:none;margin-bottom:1rem;">
          <label class="small-text">Entry:</label>
          <select id="dash-entry" style="margin-left:0.5rem;padding:0.25rem;">
            <option value="50">50 coins</option>
            <option value="100">100 coins</option>
            <option value="500">500 coins</option>
          </select>
          <div class="small-text" id="dash-coin-payout" style="margin-top:0.25rem;color:#4ade80;">Win: 85 coins (after 15% fee)</div>
        </div>
        
        <!-- Cash entry controls -->
        <div id="dash-cash-controls" style="margin-bottom:1rem;">
          <div class="bet-controls" style="justify-content:center;">
            <button class="bet-btn" id="dash-cash-down">-</button>
            <span class="bet-label" id="dash-cash-label">Entry: $1.00</span>
            <button class="bet-btn" id="dash-cash-up">+</button>
          </div>
          <div class="small-text" id="dash-cash-payout" style="margin-top:0.25rem;color:#4ade80;">Win: $1.70 (after 15% fee)</div>
          <div class="small-text" id="dash-cash-balance" style="margin-top:0.25rem;color:#9ca3af;"></div>
        </div>
        
        <button id="dash-find-race" class="btn">Find Race</button>
        <div id="dash-status" class="small-text" style="margin-top:1rem;min-height:2em;"></div>
        
        <div id="dash-waiting" style="display:none;margin-top:1rem;padding:2rem;background:#1e293b;border-radius:12px;">
          <div style="font-size:1.2rem;margin-bottom:0.5rem;">Finding Opponent...</div>
          <div id="dash-match-info" style="font-size:0.9rem;color:#4ade80;margin-bottom:0.5rem;"></div>
          <div id="dash-player-count" style="font-size:2.5rem;font-weight:bold;margin:1rem 0;color:#3b82f6;">0 / ?</div>
          <div id="dash-player-list" style="font-size:1rem;margin-bottom:0.5rem;min-height:1.5em;">Waiting...</div>
          <div id="dash-debug" class="small-text" style="color:#f97316;margin-bottom:0.75rem;min-height:1em;"></div>
          <div class="small-text" style="color:#9ca3af;margin-bottom:1rem;">Race starts when opponent joins with same entry</div>
          <button id="dash-cancel" class="btn btn-secondary">Cancel & Refund</button>
        </div>
      </div>
      
      <div id="speed-dash-race" style="display:none;">
        <div id="dash-countdown" style="text-align:center;font-size:3rem;font-weight:bold;margin-bottom:1rem;display:none;"></div>
        
        <div id="dash-track" style="position:relative;background:#1e293b;border-radius:8px;padding:1rem;margin-bottom:1rem;">
          <!-- Lanes will be rendered here -->
        </div>
        
        <div id="dash-click-zone" style="background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-radius:12px;padding:2rem;text-align:center;cursor:pointer;user-select:none;touch-action:manipulation;">
          <div style="font-size:1.5rem;font-weight:bold;color:white;">TAP TO RUN!</div>
          <div style="font-size:0.9rem;color:rgba(255,255,255,0.8);margin-top:0.5rem;">Click/tap as fast as you can</div>
          <div style="display:flex;justify-content:center;gap:1.5rem;margin-top:1rem;font-size:0.75rem;color:rgba(255,255,255,0.7);">
            <div style="display:flex;align-items:center;gap:0.3rem;">
              <span style="color:#22c55e;">🏃</span> Stamina matters!
            </div>
            <div style="display:flex;align-items:center;gap:0.3rem;">
              <span style="color:#f59e0b;">⚡</span> Pace yourself
            </div>
          </div>
        </div>
        
        <div style="background:#1e293b;border-radius:8px;padding:0.75rem;margin-top:0.5rem;font-size:0.8rem;color:#9ca3af;">
          <div style="font-weight:bold;color:#fbbf24;margin-bottom:0.3rem;">💡 Pro Tip: Stamina System</div>
          <div>Clicking too fast drains your stamina! When stamina is low, each click moves you less. Find the perfect rhythm - fast but sustainable!</div>
        </div>
        
        <div id="dash-result" style="display:none;text-align:center;margin-top:1rem;">
          <div id="dash-result-text" style="font-size:1.5rem;font-weight:bold;"></div>
          <button id="dash-play-again" class="btn" style="margin-top:1rem;">Play Again</button>
        </div>
      </div>
    </div>
  `;

  const distanceSelect = document.getElementById("dash-distance");
  const entrySelect = document.getElementById("dash-entry");
  const findRaceBtn = document.getElementById("dash-find-race");
  const statusEl = document.getElementById("dash-status");
  const waitingEl = document.getElementById("dash-waiting");
  const playerCountEl = document.getElementById("dash-player-count");
  const cancelBtn = document.getElementById("dash-cancel");
  const lobbyEl = document.getElementById("speed-dash-lobby");
  const raceEl = document.getElementById("speed-dash-race");
  const trackEl = document.getElementById("dash-track");
  const clickZoneEl = document.getElementById("dash-click-zone");
  const countdownEl = document.getElementById("dash-countdown");
  const resultEl = document.getElementById("dash-result");
  const resultTextEl = document.getElementById("dash-result-text");
  const playAgainBtn = document.getElementById("dash-play-again");
  const debugEl = document.getElementById("dash-debug");
  
  // Cash mode elements
  const modeCoinBtn = document.getElementById("dash-mode-coin");
  const modeCashBtn = document.getElementById("dash-mode-cash");
  const coinControlsEl = document.getElementById("dash-coin-controls");
  const cashControlsEl = document.getElementById("dash-cash-controls");
  const cashDownBtn = document.getElementById("dash-cash-down");
  const cashUpBtn = document.getElementById("dash-cash-up");
  const cashLabelEl = document.getElementById("dash-cash-label");
  const cashPayoutEl = document.getElementById("dash-cash-payout");
  const cashBalanceEl = document.getElementById("dash-cash-balance");
  const coinPayoutEl = document.getElementById("dash-coin-payout");
  
  // Cash mode state (coin wagers hidden for now, default to cash)
  let dashCashMode = true;
  const DASH_CASH_ENTRIES = [0.25, 0.50, 1.00, 2.00, 5.00, 10.00, 25.00];
  let dashCashIndex = 2; // Default to $1.00
  
  function getSelectedPlayerCount() {
    const playersSelect = document.getElementById("dash-players");
    return playersSelect ? parseInt(playersSelect.value) : 2;
  }
  
  function updateDashCashUI() {
    const entry = DASH_CASH_ENTRIES[dashCashIndex];
    const playerCount = getSelectedPlayerCount();
    const prize = (entry * playerCount * 0.85).toFixed(2);
    if (cashLabelEl) cashLabelEl.textContent = `Entry: $${entry.toFixed(2)}`;
    if (cashPayoutEl) cashPayoutEl.textContent = `Win: $${prize} (after 15% fee)`;
    if (cashBalanceEl && currentUser) {
      cashBalanceEl.textContent = `Balance: $${(currentUser.cash_balance || 0).toFixed(2)}`;
    }
  }
  
  function updateDashCoinPayoutUI() {
    const entry = parseInt(entrySelect?.value || 100);
    const playerCount = getSelectedPlayerCount();
    const prize = Math.round(entry * playerCount * 0.85);
    if (coinPayoutEl) coinPayoutEl.textContent = `Win: ${prize} coins (after 15% fee)`;
  }
  
  // Mode toggle handlers
  if (modeCoinBtn) {
    modeCoinBtn.addEventListener("click", () => {
      dashCashMode = false;
      modeCoinBtn.classList.add("active");
      modeCashBtn.classList.remove("active");
      if (coinControlsEl) coinControlsEl.style.display = "";
      if (cashControlsEl) cashControlsEl.style.display = "none";
    });
  }
  
  if (modeCashBtn) {
    modeCashBtn.addEventListener("click", () => {
      console.log('[SpeedDash] Cash mode button clicked');
      if (!currentUser) {
        alert("Please log in to play for cash.");
        return;
      }
      dashCashMode = true;
      console.log('[SpeedDash] dashCashMode set to:', dashCashMode);
      modeCashBtn.classList.add("active");
      modeCoinBtn.classList.remove("active");
      if (coinControlsEl) coinControlsEl.style.display = "none";
      if (cashControlsEl) cashControlsEl.style.display = "";
      updateDashCashUI();
    });
  }
  
  // Cash entry controls
  if (cashDownBtn) {
    cashDownBtn.addEventListener("click", () => {
      if (dashCashIndex > 0) {
        dashCashIndex--;
        updateDashCashUI();
      }
    });
  }
  
  if (cashUpBtn) {
    cashUpBtn.addEventListener("click", () => {
      if (dashCashIndex < DASH_CASH_ENTRIES.length - 1) {
        dashCashIndex++;
        updateDashCashUI();
      }
    });
  }
  
  // Update coin payout when entry changes
  if (entrySelect) {
    entrySelect.addEventListener("change", updateDashCoinPayoutUI);
    updateDashCoinPayoutUI();
  }

  // Coin wagers are hidden for now - default to cash mode UI
  updateDashCashUI();
  
  // Update payout display when player count changes
  const playersSelect = document.getElementById("dash-players");
  if (playersSelect) {
    playersSelect.addEventListener("change", () => {
      updateDashCashUI();
      updateDashCoinPayoutUI();
    });
  }

  // Only reset state if not already in an active game (prevents re-render wiping state)
  // Don't reset if "finished" - we want to keep the results visible!
  if (!speedDashState || speedDashState.status === "idle") {
    speedDashState = {
      lobbyId: null,
      participantId: null,
      myLane: null,
      distance: 100,
      entryFee: 100,
      maxPlayers: 2, // 2 or 3 player mode
      position: 0,
      participants: [],
      status: "idle", // idle, waiting, countdown, racing, finished
      lastClickTime: 0,
      clickCount: 0,
      fatigue: 0,
      // Cash mode
      isCashMode: false,
      cashEntry: null,
      // Provably Fair
      provablyFairId: null,
      serverSeedHash: null,
      serverSeed: null, // Revealed after game ends
      // Anti-cheat
      clickIntervals: [], // Track time between clicks
      suspicionScore: 0,
      isFlagged: false,
    };
  }
  const s = speedDashState; // Use consistent reference

  // Global function for provably fair modal - reads from current state
  window.showProvablyFairModal = function() {
    const state = speedDashState;
    const isFinished = state.status === 'finished';
    showProvablyFairInfo(
      state.serverSeedHash,
      isFinished ? state.serverSeed : null,
      state.lobbyId
    );
  };

  function cleanupSubscription() {
    if (speedDashSubscription) {
      speedDashSubscription.unsubscribe();
      speedDashSubscription = null;
    }
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  function renderTrack() {
    const s = speedDashState;
    const trackEl = document.getElementById("dash-track");
    if (!trackEl) return;

    const finishLine = s.distance;
    const me = s.participants.find(p => p.player_id === currentUser?.id);
    const myProgress = me ? Math.min(me.position / finishLine, 1) : 0;
    const metersToGo = Math.max(0, finishLine - (me?.position || 0));
    
    // Check if ANY player has finished (for finish line break effect)
    const anyoneFinished = s.participants.some(p => p.position >= finishLine);
    const winner = s.participants.find(p => p.position >= finishLine);

    // Lane colors - consistent for all players (based on lane number)
    const laneColors = {
      1: '#3b82f6', // Blue for lane 1
      2: '#ef4444', // Red for lane 2
      3: '#22c55e'  // Green for lane 3
    };

    // Helper function to render a runner body from behind
    function renderRunner(scale, shirtColor) {
      const w = Math.round(50 * scale);
      const h = Math.round(70 * scale);
      return `
        <div style="position:relative;width:${w}px;height:${h}px;">
          <div style="position:absolute;top:0;left:50%;transform:translateX(-50%);width:${20*scale}px;height:${20*scale}px;background:#d4a574;border-radius:50%;"></div>
          <div style="position:absolute;top:${2*scale}px;left:50%;transform:translateX(-50%);width:${16*scale}px;height:${10*scale}px;background:#4a3728;border-radius:50% 50% 0 0;"></div>
          <div style="position:absolute;top:${18*scale}px;left:50%;transform:translateX(-50%);width:${8*scale}px;height:${5*scale}px;background:#d4a574;"></div>
          <div style="position:absolute;top:${22*scale}px;left:50%;transform:translateX(-50%);width:${32*scale}px;height:${25*scale}px;background:${shirtColor};border-radius:${6*scale}px ${6*scale}px 0 0;"></div>
          <div style="position:absolute;top:${24*scale}px;left:${4*scale}px;width:${7*scale}px;height:${20*scale}px;background:#d4a574;border-radius:${3*scale}px;transform:rotate(-12deg);"></div>
          <div style="position:absolute;top:${24*scale}px;right:${4*scale}px;width:${7*scale}px;height:${20*scale}px;background:#d4a574;border-radius:${3*scale}px;transform:rotate(12deg);"></div>
          <div style="position:absolute;top:${45*scale}px;left:50%;transform:translateX(-50%);width:${28*scale}px;height:${14*scale}px;background:#222;border-radius:0 0 ${3*scale}px ${3*scale}px;"></div>
          <div style="position:absolute;top:${57*scale}px;left:${12*scale}px;width:${8*scale}px;height:${12*scale}px;background:#d4a574;border-radius:${2*scale}px;"></div>
          <div style="position:absolute;top:${57*scale}px;right:${12*scale}px;width:${8*scale}px;height:${12*scale}px;background:#d4a574;border-radius:${2*scale}px;"></div>
        </div>
      `;
    }

    // Animation offset for moving lane markers
    const markerOffset = (me?.position || 0) % 30;
    
    // Clean 2D track with trapezoid perspective (no broken 3D)
    let html = `
      <div style="position:relative;height:380px;overflow:hidden;border-radius:12px;background:linear-gradient(to bottom, #1a1a2e 0%, #16213e 100%);">
        
        <!-- Track surface using clip-path for clean perspective -->
        <svg style="position:absolute;bottom:0;left:0;width:100%;height:85%;" viewBox="0 0 100 100" preserveAspectRatio="none">
          <!-- Track background -->
          <polygon points="0,100 100,100 75,0 25,0" fill="url(#trackGrad)"/>
          
          <!-- Lane lines - 4 lines converging to vanishing point at top center -->
          <line x1="20" y1="100" x2="35" y2="0" stroke="white" stroke-width="0.3" opacity="0.8"/>
          <line x1="40" y1="100" x2="45" y2="0" stroke="white" stroke-width="0.3" opacity="0.8"/>
          <line x1="60" y1="100" x2="55" y2="0" stroke="white" stroke-width="0.3" opacity="0.8"/>
          <line x1="80" y1="100" x2="65" y2="0" stroke="white" stroke-width="0.3" opacity="0.8"/>
          
          <!-- Horizontal distance markers -->
          ${[15, 30, 45, 60, 75].map(y => {
            const width = 80 - y * 0.6;
            const x1 = 50 - width/2;
            const x2 = 50 + width/2;
            return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="white" stroke-width="0.15" opacity="${0.3 + (1-y/100)*0.4}"/>`;
          }).join('')}
          
          <defs>
            <linearGradient id="trackGrad" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" style="stop-color:#c44536"/>
              <stop offset="50%" style="stop-color:#a83328"/>
              <stop offset="100%" style="stop-color:#7a2419"/>
            </linearGradient>
          </defs>
        </svg>
        
        <!-- Finish line tape - rips open when ANYONE finishes -->
        ${anyoneFinished ? `
          <!-- Ripped tape effect - two pieces flying apart -->
          <div style="position:absolute;top:68%;left:5%;width:40%;height:18px;background:repeating-linear-gradient(90deg,#fff 0,#fff 6px,#111 6px,#111 12px);z-index:5;transform:rotate(-15deg) translateY(-20px);opacity:0.8;"></div>
          <div style="position:absolute;top:68%;right:5%;width:40%;height:18px;background:repeating-linear-gradient(90deg,#fff 0,#fff 6px,#111 6px,#111 12px);z-index:5;transform:rotate(15deg) translateY(-20px);opacity:0.8;"></div>
          <div style="position:absolute;top:62%;left:50%;transform:translateX(-50%);z-index:6;">
            <div style="font-size:1.1rem;color:#fff;font-weight:bold;background:linear-gradient(135deg,#22c55e,#16a34a);padding:8px 20px;border-radius:8px;box-shadow:0 4px 20px rgba(34,197,94,0.5);">🏆 ${winner?.username || 'WINNER'} wins!</div>
          </div>
        ` : `
          <!-- Normal tape approaching -->
          <div style="position:absolute;top:${15 + myProgress * 55}%;left:${22 - myProgress * 12}%;right:${22 - myProgress * 12}%;height:${4 + myProgress * 14}px;background:repeating-linear-gradient(90deg,#fff 0,#fff 6px,#111 6px,#111 12px);z-index:5;"></div>
          <div style="position:absolute;top:${11 + myProgress * 53}%;left:50%;transform:translateX(-50%);z-index:6;">
            <div style="font-size:${0.55 + myProgress * 0.4}rem;color:#fff;font-weight:bold;background:#7c3aed;padding:${2 + myProgress * 4}px ${8 + myProgress * 8}px;border-radius:4px;">FINISH</div>
          </div>
        `}
        
        <!-- HUD -->
        <div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.8);padding:6px 14px;border-radius:16px;color:#fff;font-size:0.9rem;">
          <span style="color:#4ade80;font-weight:bold;">${metersToGo.toFixed(0)}m</span> to go
        </div>
        <div style="position:absolute;top:8px;left:8px;background:rgba(0,0,0,0.8);padding:6px 14px;border-radius:16px;color:#fff;font-size:0.9rem;">
          <span style="color:#fbbf24;">⚡</span> <span style="font-weight:bold;">${(me?.position || 0).toFixed(0)}m</span>
        </div>
        <div style="position:absolute;top:44px;left:8px;background:${(() => {
          if (!me) return '#9ca3af';
          const ahead = s.participants.filter(p => p.player_id !== currentUser?.id && p.position > me.position).length;
          if (ahead === 0) return '#22c55e';
          if (ahead === 1) return '#f59e0b';
          return '#ef4444';
        })()};padding:4px 10px;border-radius:4px;color:#fff;font-size:0.75rem;font-weight:bold;">
          ${(() => {
            if (!me) return '?';
            const ahead = s.participants.filter(p => p.player_id !== currentUser?.id && p.position > me.position).length;
            return ahead === 0 ? '1st' : ahead === 1 ? '2nd' : '3rd';
          })()}
        </div>
        
        <!-- Stamina/Fatigue Bar -->
        <div style="position:absolute;top:44px;right:8px;background:rgba(0,0,0,0.8);padding:6px 10px;border-radius:8px;min-width:100px;" title="Stamina: Click too fast and you'll tire out! Pace yourself for maximum power.">
          <div style="color:#9ca3af;font-size:0.65rem;margin-bottom:3px;display:flex;justify-content:space-between;">
            <span>🏃 STAMINA</span>
            <span style="color:${s.fatigue > 0.3 ? '#ef4444' : '#22c55e'};">${Math.round((1 - s.fatigue) * 100)}%</span>
          </div>
          <div style="width:100%;height:8px;background:#374151;border-radius:4px;overflow:hidden;">
            <div style="width:${(1 - s.fatigue) * 100}%;height:100%;background:${s.fatigue > 0.3 ? (s.fatigue > 0.4 ? '#ef4444' : '#f59e0b') : '#22c55e'};transition:width 0.1s;"></div>
          </div>
        </div>
        <!-- Provably Fair Badge - clickable during game to show hash -->
        ${s.serverSeedHash ? `
        <div id="track-provably-fair-badge" style="position:absolute;bottom:8px;right:8px;z-index:100;cursor:pointer;">
          ${renderProvablyFairBadge(s.serverSeedHash, true)}
        </div>
        ` : ''}
    `;

    // Base position for runners (at bottom of visible track)
    const baseBottom = 5;
    const baseScale = 1.3;

    // Lane centers matching the SVG lanes (support 2 or 3 players)
    const maxPlayers = s.maxPlayers || 2;
    const laneCenter1 = maxPlayers === 3 ? 25 : 30; // Left lane
    const laneCenter2 = 50; // Middle lane (only used in 3-player mode)
    const laneCenter3 = maxPlayers === 3 ? 75 : 70; // Right lane
    
    // Simple function to get lane X from database lane value
    const getLaneX = (dbLane) => {
      if (maxPlayers === 3) {
        if (dbLane === 1) return laneCenter1;
        if (dbLane === 2) return laneCenter2;
        return laneCenter3;
      }
      return (dbLane === 2) ? laneCenter3 : laneCenter1;
    };

    // UNIFIED perspective function - works for ALL distances (negative = behind, positive = ahead)
    // This ensures completely smooth transitions with no jumps
    const getRunnerVisuals = (relativeDistance, laneX) => {
      // Calculate lane position that converges toward center (50) as runner gets further away
      // At bottom (close): full lane offset. At top (far): converges to center.
      const laneOffset = laneX - 50;
      
      if (relativeDistance <= -25) {
        // Very far behind - completely invisible
        return { bottom: baseBottom, scale: 0, xPercent: laneX, opacity: 0, zIndex: 0 };
      }
      
      if (relativeDistance < 0) {
        // Behind: smoothly fade in and scale up as they approach
        const progress = (relativeDistance + 25) / 25; // 0 at -25m, 1 at 0m
        const smoothProgress = progress * progress; // ease in
        return {
          bottom: baseBottom,
          scale: baseScale * smoothProgress,
          xPercent: laneX, // Stay in lane when behind/tied
          opacity: smoothProgress,
          zIndex: 11
        };
      }
      
      // 0 or ahead: smooth continuous movement up the track
      const maxDist = 100; // Full race distance
      const t = Math.min(relativeDistance / maxDist, 1);
      // Smooth curve for natural perspective
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
      
      // X position must FOLLOW the lane lines' convergence toward center
      // SVG lane lines converge: lane 1 goes from 30% to 40%, lane 2 goes from 70% to 60%
      // So converge 50% toward center (50%) at max distance
      const xConverged = 50 + laneOffset * (1 - eased * 0.5);
      
      return {
        bottom: baseBottom + eased * 70, // Go much higher on track (up to 75% from bottom)
        scale: baseScale * (1 - eased * 0.7), // Scale down to ~0.4 at max distance
        xPercent: xConverged, // Follow lane line convergence
        opacity: Math.max(0.5, 1 - eased * 0.5), // Stay visible but fade slightly
        zIndex: Math.max(1, 9 - Math.floor(t * 8))
      };
    };

    // Render YOUR runner - use myLane from state (most reliable source)
    if (me) {
      const myLane = s.myLane || me.lane || 1;
      const laneX = getLaneX(myLane);
      const shirtColor = laneColors[myLane] || laneColors[1];

      html += `
        <div style="position:absolute;bottom:${baseBottom}%;left:${laneX}%;transform:translateX(-50%);z-index:10;">
          ${renderRunner(baseScale, shirtColor)}
        </div>
      `;
    }

    // Add opponent runners to the HTML with smooth positioning
    s.participants.forEach((p) => {
      const isMe = p.player_id === currentUser?.id;
      if (isMe) return;

      // Get opponent lane from their actual lane data
      const oppLane = p.lane || 2;
      const baseLaneX = getLaneX(oppLane);
      const shirtColor = laneColors[oppLane] || '#ef4444';

      // Use interpolated display position for smooth movement
      const oppPosition = p._displayPosition ?? p.position;
      const relativeToMe = me ? (oppPosition - me.position) : 0;
      const vis = getRunnerVisuals(relativeToMe, baseLaneX);

      if (vis.opacity <= 0.01 || vis.scale <= 0.05) return;

      // Use CSS transform for scaling to ensure smooth animation
      const scaleRatio = vis.scale / baseScale;
      
      html += `
        <div style="position:absolute;bottom:${vis.bottom}%;left:${vis.xPercent}%;transform:translateX(-50%) scale(${scaleRatio});transform-origin:center bottom;z-index:${vis.zIndex};opacity:${vis.opacity};">
          ${renderRunner(baseScale, shirtColor)}
          ${vis.scale >= 0.7 ? `
            <div style="text-align:center;font-size:0.55rem;color:#fff;background:${shirtColor}dd;padding:2px 6px;border-radius:6px;margin-top:2px;white-space:nowrap;">
              @${p.username || "OPP"}
            </div>
          ` : ''}
        </div>
      `;
    });

    html += `</div>`;
    trackEl.innerHTML = html;
    
    // Add click listener for provably fair badge
    const pfBadge = document.getElementById('track-provably-fair-badge');
    if (pfBadge) {
      pfBadge.onclick = function(e) {
        e.stopPropagation();
        const state = speedDashState;
        const isFinished = state.status === 'finished';
        window.showProvablyFairInfo(
          state.serverSeedHash,
          isFinished ? state.serverSeed : null,
          state.lobbyId
        );
      };
    }
  }

  async function findOrCreateLobby() {
    // Prevent double-clicks immediately
    if (findRaceBtn.disabled) return;
    findRaceBtn.disabled = true;
    findRaceBtn.textContent = "Joining...";

    if (!supabaseClient || !currentUser) {
      statusEl.textContent = "Please log in to race.";
      findRaceBtn.disabled = false;
      findRaceBtn.textContent = "Find Race";
      return;
    }

    // Check if player is banned before allowing them to play
    const canPlay = await checkBanBeforeGame('speed_dash');
    if (!canPlay) {
      findRaceBtn.disabled = false;
      findRaceBtn.textContent = "Find Race";
      return;
    }

    const s = speedDashState;
    
    // Already in a race? Check if it's actually still valid
    if (s.status === "waiting" || s.status === "racing") {
      // Check if our participation still exists in DB
      const { data: myParticipation } = await supabaseClient
        .from("race_participants")
        .select("id")
        .eq("player_id", currentUser.id)
        .limit(1);
      
      if (myParticipation && myParticipation.length > 0) {
        statusEl.textContent = "Already in a race! Click Cancel to leave.";
        findRaceBtn.disabled = false;
        findRaceBtn.textContent = "Find Race";
        return;
      } else {
        // Our participation was cleaned up, reset state
        console.log('[SpeedDash] Stale state detected, resetting...');
        s.status = "idle";
        s.lobbyId = null;
        s.participantId = null;
      }
    }

    s.distance = parseInt(distanceSelect.value);
    s.isCashMode = dashCashMode;
    
    // Get player count from selector
    const playersSelect = document.getElementById("dash-players");
    s.maxPlayers = playersSelect ? parseInt(playersSelect.value) : 2;
    
    console.log('[SpeedDash] Find Race clicked - dashCashMode:', dashCashMode, 'maxPlayers:', s.maxPlayers, 'dashCashIndex:', dashCashIndex);
    
    if (dashCashMode) {
      s.cashEntry = DASH_CASH_ENTRIES[dashCashIndex];
      s.entryFee = 0; // Not using coins
      
      if ((currentUser.cash_balance || 0) < s.cashEntry) {
        statusEl.textContent = `Not enough cash. Need $${s.cashEntry.toFixed(2)}`;
        findRaceBtn.disabled = false;
        findRaceBtn.textContent = "Find Race";
        return;
      }
    } else {
      s.entryFee = parseInt(entrySelect.value);
      s.cashEntry = null;
      
      if ((currentUser.coin_balance || 0) < s.entryFee) {
        statusEl.textContent = "Not enough coins for entry fee.";
        findRaceBtn.disabled = false;
        findRaceBtn.textContent = "Find Race";
        return;
      }
    }

    statusEl.textContent = "Finding a race...";
    const currency = dashCashMode ? "CASH" : "COIN";
    const entryAmount = dashCashMode ? s.cashEntry : s.entryFee;
    if (debugEl) debugEl.textContent = `state=${s.status}, distance=${s.distance}, entry=${entryAmount} ${currency}`;

    try {
      // First, clean up any old WAITING participation (not finished games - we need those for history!)
      // Get waiting lobby IDs first
      const { data: waitingLobbies } = await supabaseClient
        .from("race_lobbies")
        .select("id")
        .eq("status", "waiting");
      
      if (waitingLobbies && waitingLobbies.length > 0) {
        const waitingLobbyIds = waitingLobbies.map(l => l.id);
        await supabaseClient
          .from("race_participants")
          .delete()
          .eq("player_id", currentUser.id)
          .in("lobby_id", waitingLobbyIds);
      }

      // Look for an open lobby with matching settings
      const { data: openLobbies, error: lobbyError } = await supabaseClient
        .from("race_lobbies")
        .select("*")
        .eq("distance", s.distance)
        .eq("entry_fee", entryAmount)
        .eq("currency", currency)
        .eq("max_players", s.maxPlayers)
        .eq("status", "waiting")
        .lt("current_players", s.maxPlayers)
        .order("created_at", { ascending: true })
        .limit(1);

      if (lobbyError) throw lobbyError;

      let lobby;
      if (openLobbies && openLobbies.length > 0) {
        lobby = openLobbies[0];
        console.log('[SpeedDash] Found existing lobby:', lobby.id, 'maxPlayers:', lobby.max_players);
      } else {
        // No lobby found - create one, but first add a small delay to reduce race conditions
        await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
        
        // Search again after delay (another player may have created one)
        const { data: retryLobbies } = await supabaseClient
          .from("race_lobbies")
          .select("*")
          .eq("distance", s.distance)
          .eq("entry_fee", entryAmount)
          .eq("currency", currency)
          .eq("max_players", s.maxPlayers)
          .eq("status", "waiting")
          .lt("current_players", s.maxPlayers)
          .order("created_at", { ascending: true })
          .limit(1);
        
        if (retryLobbies && retryLobbies.length > 0) {
          lobby = retryLobbies[0];
          console.log('[SpeedDash] Found lobby on retry:', lobby.id);
        } else {
          // Still no lobby - create one
          const { data: newLobby, error: createError } = await supabaseClient
            .from("race_lobbies")
            .insert({
              distance: s.distance,
              entry_fee: entryAmount,
              currency: currency,
              status: "waiting",
              max_players: s.maxPlayers,
              current_players: 0,
            })
            .select()
            .single();

          if (createError) throw createError;
          lobby = newLobby;
          console.log('[SpeedDash] Created new lobby:', lobby.id, 'for', s.maxPlayers, 'players');
        }
      }

      s.lobbyId = lobby.id;
      
      // Read currency from lobby to ensure state is correct (especially for player 2)
      console.log('[SpeedDash] Lobby data:', JSON.stringify(lobby));
      
      // Read max_players from lobby (important for player 2/3 joining)
      s.maxPlayers = lobby.max_players || 2;
      
      // If lobby has currency column, use it; otherwise keep UI selection
      if (lobby.currency !== undefined && lobby.currency !== null) {
        s.isCashMode = lobby.currency === "CASH";
        if (s.isCashMode) {
          s.cashEntry = parseFloat(lobby.entry_fee) || entryAmount;
          s.entryFee = 0;
        } else {
          s.entryFee = parseInt(lobby.entry_fee) || entryAmount;
          s.cashEntry = null;
        }
      } else {
        // Currency column doesn't exist - use the values we already set from UI
        console.log('[SpeedDash] No currency column, using UI selection:', dashCashMode);
      }
      console.log('[SpeedDash] After lobby join - isCashMode:', s.isCashMode, 'maxPlayers:', s.maxPlayers, 'cashEntry:', s.cashEntry, 'entryFee:', s.entryFee);

      // Get current participants to determine lane
      const { data: existingParticipants } = await supabaseClient
        .from("race_participants")
        .select("id, lobby_id, lane, player_id, username, position")
        .eq("lobby_id", lobby.id);

      // Check if we're already in this lobby
      const alreadyIn = existingParticipants?.find(p => p.player_id === currentUser.id);
      if (alreadyIn) {
      }

      const usedLanes = existingParticipants?.map(p => p.lane) || [];
      let myLane = 1;
      const maxLanes = s.maxPlayers || 2;
      while (usedLanes.includes(myLane) && myLane <= maxLanes) myLane++;

      // Join the lobby
      // Only insert if we weren't already in this lobby
      let myParticipant = alreadyIn || null;
      if (!alreadyIn) {
        const { data: participant, error: joinError } = await supabaseClient
          .from("race_participants")
          .insert({
            lobby_id: lobby.id,
            player_id: currentUser.id,
            username: currentUser.username,
            lane: myLane,
            position: 0,
          })
          .select()
          .single();

        if (joinError) throw joinError;
        myParticipant = participant;
      }

      if (myParticipant) {
        s.participantId = myParticipant.id;
        s.myLane = myParticipant.lane;
      }

      // Create Provably Fair record for this game
      try {
        const pfGame = await ProvablyFair.createGame('speed_dash', lobby.id, currentUser.id);
        if (pfGame) {
          s.provablyFairId = pfGame.id;
          s.serverSeedHash = pfGame.serverSeedHash;
          s.serverSeed = pfGame.serverSeed; // Store for reveal after game
          console.log('[ProvablyFair] Game created, hash:', pfGame.serverSeedHash.substring(0, 16) + '...');
        }
      } catch (pfErr) {
        console.warn('[ProvablyFair] Could not create record:', pfErr);
      }

      // Seed local participants list BEFORE coin deduction (which triggers re-render)
      const others = existingParticipants || [];
      const combined = myParticipant && !alreadyIn ? [...others, myParticipant] : others;
      s.participants = combined;
      s.status = "waiting"; // Set BEFORE adjustCurrentUserCoins so re-render preserves state

      // Only deduct entry if we just joined (not already in this lobby)
      if (alreadyIn) {
        console.log('[SpeedDash] Already in lobby, skipping deduction');
      } else {
        // Deduct entry fee (this may trigger render() but state is preserved now)
        console.log('[SpeedDash] Deducting entry - isCashMode:', s.isCashMode, 'cashEntry:', s.cashEntry, 'entryFee:', s.entryFee);
        statusEl.textContent = `Deducting ${s.isCashMode ? '$' + s.cashEntry : s.entryFee + ' coins'}...`;
        
        if (s.isCashMode && s.cashEntry) {
          // Cash mode - deduct from cash_balance via server
          const oldBalance = currentUser.cash_balance || 0;
          const newBalance = oldBalance - s.cashEntry;
          console.log('[SpeedDash] CASH DEDUCTION - old:', oldBalance, 'amount:', s.cashEntry, 'new:', newBalance);
          
          const { data: deductData, error: cashErr } = await supabaseClient
            .from("profiles")
            .update({ cash_balance: newBalance })
            .eq("id", currentUser.id)
            .select("cash_balance")
            .single();
          
          if (cashErr) {
            console.error('[SpeedDash] Cash deduction error:', cashErr);
            throw cashErr;
          }
          console.log('[SpeedDash] Cash deducted successfully:', deductData);
          currentUser.cash_balance = deductData?.cash_balance ?? newBalance;
          // Update UI balance display without full render
          updateBalanceDisplay();
        } else {
          console.log('[SpeedDash] COIN DEDUCTION - amount:', s.entryFee);
          await adjustCurrentUserCoins(-s.entryFee);
          updateBalanceDisplay();
        }
      }

      // Update lobby player count
      await supabaseClient
        .from("race_lobbies")
        .update({ current_players: (lobby.current_players || 0) + 1 })
        .eq("id", lobby.id);

      // Show waiting UI FIRST (before updateWaitingUI which might start countdown)
      // Use fresh DOM refs in case render() was called during adjustCurrentUserCoins
      try {
        const freshLobbyEl = document.getElementById("speed-dash-lobby");
        const freshWaitingEl = document.getElementById("dash-waiting");
        const freshFindRaceBtn = document.getElementById("dash-find-race");
        const freshStatusEl = document.getElementById("dash-status");
        const freshDebugEl = document.getElementById("dash-debug");
        
        
        if (freshLobbyEl) {
          const h3 = freshLobbyEl.querySelector("h3");
          const p = freshLobbyEl.querySelector("p");
          if (h3) h3.style.display = "none";
          if (p) p.style.display = "none";
        }
        // Hide distance/entry selects and mode toggle
        const distEl = document.getElementById("dash-distance");
        const entryEl = document.getElementById("dash-entry");
        const modeToggleEl = freshLobbyEl?.querySelector(".mode-toggle");
        const coinCtrlEl = document.getElementById("dash-coin-controls");
        const cashCtrlEl = document.getElementById("dash-cash-controls");
        if (distEl && distEl.parentElement) distEl.parentElement.style.display = "none";
        if (entryEl && entryEl.parentElement) entryEl.parentElement.style.display = "none";
        if (modeToggleEl) modeToggleEl.style.display = "none";
        if (coinCtrlEl) coinCtrlEl.style.display = "none";
        if (cashCtrlEl) cashCtrlEl.style.display = "none";
        if (freshFindRaceBtn) freshFindRaceBtn.style.display = "none";
        if (freshStatusEl) freshStatusEl.textContent = "";
        if (freshWaitingEl) freshWaitingEl.style.display = "block";
        if (freshDebugEl) freshDebugEl.textContent = `state=waiting, lobby=${s.lobbyId}, players=${combined.length}`;
        
        // Show what we're looking for
        const matchInfoEl = document.getElementById("dash-match-info");
        if (matchInfoEl) {
          const entryLabel = s.isCashMode ? `$${s.cashEntry?.toFixed(2)} CASH` : `${s.entryFee} COINS`;
          matchInfoEl.innerHTML = `Looking for: <strong>${s.distance}m</strong> race • <strong>${entryLabel}</strong>`;
        }
        
      } catch (uiErr) {
        console.error("[SpeedDash] Error showing waiting UI:", uiErr);
      }

      // Now update UI (may trigger countdown if 2 players)
      updateWaitingUI();

      // Subscribe to lobby and participants for updates
      subscribeToLobby(lobby.id);

    } catch (err) {
      console.error("Join race error:", err);
      statusEl.textContent = "Failed to join race: " + (err.message || err);
      findRaceBtn.disabled = false;
      findRaceBtn.textContent = "Find Race";
      findRaceBtn.style.display = "";
      s.status = "idle";
    }
  }

  let pollingInterval = null;

  function subscribeToLobby(lobbyId) {
    cleanupSubscription();

    // Ultra-fast polling for near real-time opponent updates
    pollingInterval = setInterval(() => {
      pollLobbyState(lobbyId);
    }, 50); // Poll every 50ms (20 times per second)

    // Initial load
    pollLobbyState(lobbyId);
  }

  async function pollLobbyState(lobbyId) {
    const s = speedDashState;
    if (!s.lobbyId || s.status === "finished") {
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      return;
    }

    try {
      // Load lobby status
      const { data: lobby } = await supabaseClient
        .from("race_lobbies")
        .select("*")
        .eq("id", lobbyId)
        .single();

      if (lobby && lobby.status !== "waiting" && s.status === "waiting") {
        handleLobbyUpdate(lobby);
      }

      // Load participants
      const { data: participants } = await supabaseClient
        .from("race_participants")
        .select("*")
        .eq("lobby_id", lobbyId)
        .order("lane");

      if (participants) {
        // Smooth opponent position updates by interpolating toward target
        participants.forEach(newP => {
          const oldP = s.participants.find(p => p.id === newP.id);
          if (oldP && newP.player_id !== currentUser?.id) {
            // Store target position, keep current display position
            newP._targetPosition = newP.position;
            newP._displayPosition = oldP._displayPosition ?? oldP.position;
          } else {
            newP._targetPosition = newP.position;
            newP._displayPosition = newP.position;
          }
        });
        s.participants = participants;
        if (debugEl) debugEl.textContent = `state=${s.status}, players=${participants.length}`;
        
        if (s.status === "waiting") {
          updateWaitingUI();
        } else if (s.status === "racing") {
          renderTrack();
          checkForWinner();
        }
      }
    } catch (e) {
      console.error("Polling error:", e);
    }
  }

  function cleanupPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  function handleParticipantUpdate(payload) {
    const s = speedDashState;
    
    if (payload.eventType === "INSERT") {
      const exists = s.participants.find(p => p.id === payload.new.id);
      if (!exists) {
        s.participants.push(payload.new);
      }
    } else if (payload.eventType === "UPDATE") {
      const idx = s.participants.findIndex(p => p.id === payload.new.id);
      if (idx >= 0) {
        s.participants[idx] = payload.new;
      }
    } else if (payload.eventType === "DELETE") {
      s.participants = s.participants.filter(p => p.id !== payload.old.id);
    }

    if (s.status === "waiting") {
      updateWaitingUI();
    } else if (s.status === "racing") {
      renderTrack();
      checkForWinner();
    }
  }

  function handleLobbyUpdate(lobby) {
    const s = speedDashState;
    
    if (lobby.status === "countdown" && s.status === "waiting") {
      s.status = "countdown";
      // Use the synced countdown start time from database
      startCountdown(lobby.countdown_started_at);
    } else if (lobby.status === "complete" && s.status !== "finished") {
      s.status = "finished";
      showResult(lobby.winner_id);
    }
  }

  function updateWaitingUI() {
    const s = speedDashState;
    const count = s.participants.length;
    const maxPlayers = s.maxPlayers || 2;
    
    // Use fresh DOM references (in case render() was called)
    const playerCountEl = document.getElementById("dash-player-count");
    const listEl = document.getElementById("dash-player-list");
    const debugEl = document.getElementById("dash-debug");
    
    if (playerCountEl) playerCountEl.textContent = `${count} / ${maxPlayers}`;

    // Show who's in the lobby
    const playerList = s.participants.map(p => {
      const isMe = p.player_id === currentUser?.id;
      return isMe ? `<strong>YOU</strong>` : `@${p.username || "Player"}`;
    }).join(" vs ");
    
    if (listEl) {
      listEl.innerHTML = playerList || "Waiting...";
    }
    if (debugEl) {
      debugEl.textContent = `state=${s.status}, players=${count}/${maxPlayers}`;
    }

    // Auto-start when all players join - set countdown start time in database for sync
    if (count >= maxPlayers && (s.status === "waiting" || s.status === "idle")) {
      s.status = "countdown";
      // Set the countdown start time in database so all clients sync
      const countdownStart = new Date().toISOString();
      supabaseClient
        .from("race_lobbies")
        .update({ status: "countdown", countdown_started_at: countdownStart })
        .eq("id", s.lobbyId)
        .then(() => {
          startCountdown(countdownStart);
        });
    }
  }

  function startCountdown(countdownStartTime) {
    const s = speedDashState;
    
    // Calculate how much time has passed since countdown started (for sync)
    const startTime = countdownStartTime ? new Date(countdownStartTime).getTime() : Date.now();
    const elapsed = Date.now() - startTime;
    const totalCountdownMs = 4000; // 3 seconds + 1 second for "GO!"
    const remainingMs = Math.max(0, totalCountdownMs - elapsed);
    
    // Use fresh DOM references (in case render() was called)
    const lobbyEl = document.getElementById("speed-dash-lobby");
    const raceEl = document.getElementById("speed-dash-race");
    const countdownEl = document.getElementById("dash-countdown");
    const clickZoneEl = document.getElementById("dash-click-zone");
    
    try {
      lobbyEl.style.display = "none";
      raceEl.style.display = "block";
      countdownEl.style.display = "block";
      countdownEl.style.color = "#fff";
      clickZoneEl.style.pointerEvents = "none";
      clickZoneEl.style.opacity = "0.5";

      renderTrack();

      // Calculate which count to show based on remaining time
      const showCount = () => {
        const now = Date.now();
        const elapsedSinceStart = now - startTime;
        const remaining = totalCountdownMs - elapsedSinceStart;
        
        if (remaining > 3000) {
          countdownEl.textContent = "3";
        } else if (remaining > 2000) {
          countdownEl.textContent = "2";
        } else if (remaining > 1000) {
          countdownEl.textContent = "1";
        } else if (remaining > 0) {
          countdownEl.textContent = "GO!";
          countdownEl.style.color = "#22c55e";
        } else {
          clearInterval(countdownInterval);
          countdownEl.style.display = "none";
          beginRacing();
          return;
        }
      };
      
      showCount(); // Show immediately
      const countdownInterval = setInterval(showCount, 100); // Update every 100ms for accuracy
      
    } catch (err) {
      console.error("[SpeedDash] startCountdown error:", err);
    }
  }

  async function beginRacing() {
    const s = speedDashState;
    s.status = "racing";
    s.lastClickTime = Date.now();
    s.clickCount = 0;
    s.fatigue = 0;

    // Use fresh DOM ref and re-attach click handler
    const clickZoneEl = document.getElementById("dash-click-zone");
    if (clickZoneEl) {
      clickZoneEl.style.pointerEvents = "auto";
      clickZoneEl.style.opacity = "1";
      // Re-attach click handler (in case DOM was replaced)
      clickZoneEl.onclick = handleClick;
    }

    // Update lobby to racing
    await supabaseClient
      .from("race_lobbies")
      .update({ status: "racing", started_at: new Date().toISOString() })
      .eq("id", s.lobbyId);

    // Start animation loop
    speedDashAnimId = requestAnimationFrame(raceLoop);
  }

  function raceLoop() {
    const s = speedDashState;
    if (s.status !== "racing") return;

    // Fatigue recovery (very slow - only 0.3% per frame, ~18% per second at 60fps)
    s.fatigue = Math.max(0, s.fatigue - 0.003);

    // Smoothly interpolate opponent positions toward their targets
    s.participants.forEach(p => {
      if (p.player_id !== currentUser?.id && p._targetPosition !== undefined) {
        const target = p._targetPosition;
        const current = p._displayPosition ?? p.position;
        // Lerp 20% toward target each frame for faster catch-up
        p._displayPosition = current + (target - current) * 0.2;
      }
    });

    renderTrack();
    speedDashAnimId = requestAnimationFrame(raceLoop);
  }

  // Anti-cheat: Calculate standard deviation of click intervals
  function calculateClickVariance(intervals) {
    if (intervals.length < 5) return { mean: 0, stdDev: 100, cv: 1 }; // Not enough data
    
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const squaredDiffs = intervals.map(x => Math.pow(x - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean; // Coefficient of variation (lower = more robotic)
    
    return { mean, stdDev, cv };
  }

  // Anti-cheat: Log suspicious activity for admin review
  async function logSuspiciousActivity(playerId, username, reason, data) {
    console.warn(`[ANTI-CHEAT] Suspicious activity: ${username} - ${reason}`, data);
    
    try {
      // Log to database for admin review
      await supabaseClient.from('cheat_logs').insert({
        player_id: playerId,
        username: username,
        reason: reason,
        data: JSON.stringify(data),
        lobby_id: speedDashState.lobbyId,
        ip_address: null, // Would need server-side to get real IP
        created_at: new Date().toISOString()
      });
    } catch (e) {
      console.error('[ANTI-CHEAT] Could not log:', e);
    }
  }

  async function handleClick() {
    const s = speedDashState;
    if (s.status !== "racing") return;
    
    // If already flagged as cheater, severely penalize
    if (s.isFlagged) {
      // Cheater gets almost no distance - essentially frozen
      s.position += 0.01;
      return;
    }

    const now = Date.now();
    const timeSinceLastClick = now - s.lastClickTime;
    
    // Track click intervals for variance analysis (skip first click)
    if (s.lastClickTime > 0 && timeSinceLastClick > 0 && timeSinceLastClick < 1000) {
      s.clickIntervals.push(timeSinceLastClick);
      
      // Keep only last 20 intervals for analysis
      if (s.clickIntervals.length > 20) {
        s.clickIntervals.shift();
      }
      
      // Analyze click pattern after enough data
      if (s.clickIntervals.length >= 10) {
        const { mean, stdDev, cv } = calculateClickVariance(s.clickIntervals);
        
        // DETECTION RULES:
        // 1. Coefficient of variation < 0.1 = extremely consistent (bot-like)
        // 2. Mean interval < 50ms = impossibly fast
        // 3. StdDev < 5ms with fast clicking = robotic precision
        
        if (cv < 0.08 && mean < 150) {
          // Extremely robotic pattern - high confidence bot
          s.suspicionScore += 30;
        } else if (cv < 0.12 && mean < 120) {
          // Very consistent fast clicking
          s.suspicionScore += 15;
        } else if (stdDev < 8 && mean < 100) {
          // Impossibly precise timing
          s.suspicionScore += 20;
        } else if (mean < 40) {
          // Superhuman speed (>25 clicks/sec)
          s.suspicionScore += 25;
        }
        
        // Natural human clicking reduces suspicion
        if (cv > 0.25 && stdDev > 20) {
          s.suspicionScore = Math.max(0, s.suspicionScore - 2);
        }
        
        // FLAG THRESHOLD: suspicion score > 50
        if (s.suspicionScore >= 50 && !s.isFlagged) {
          s.isFlagged = true;
          logSuspiciousActivity(currentUser.id, currentUser.username, 'BOT_DETECTED', {
            clickIntervals: s.clickIntervals,
            mean: mean.toFixed(2),
            stdDev: stdDev.toFixed(2),
            cv: cv.toFixed(3),
            suspicionScore: s.suspicionScore,
            clickCount: s.clickCount
          });
          
          // Show warning to the cheater
          const warning = document.createElement('div');
          warning.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#dc2626;color:white;padding:20px 40px;border-radius:12px;z-index:9999;font-weight:bold;text-align:center;';
          warning.innerHTML = '⚠️ Unusual Activity Detected<br><span style="font-size:0.8em;font-weight:normal;">Your clicking pattern has been flagged for review.</span>';
          document.body.appendChild(warning);
          setTimeout(() => warning.remove(), 3000);
        }
      }
    }
    
    s.lastClickTime = now;
    s.clickCount++;

    // Calculate distance per click (with fatigue)
    // Base: 1.2-1.8 meters per click (~55-85 clicks to win)
    const baseDistance = 1.2 + Math.random() * 0.6;
    // At 0% stamina (fatigue=1.0), you only get 10% distance!
    const fatigueMultiplier = Math.max(0.1, 1 - s.fatigue * 0.9);
    const distance = baseDistance * fatigueMultiplier;

    // Increase fatigue with every click (faster = more fatigue, can drain to 0!)
    if (timeSinceLastClick < 60) {
      // Inhuman speed - massive fatigue
      s.fatigue = Math.min(1.0, s.fatigue + 0.15);
    } else if (timeSinceLastClick < 100) {
      // Very fast clicking - high fatigue
      s.fatigue = Math.min(1.0, s.fatigue + 0.10);
    } else if (timeSinceLastClick < 150) {
      // Fast clicking - medium fatigue
      s.fatigue = Math.min(1.0, s.fatigue + 0.06);
    } else if (timeSinceLastClick < 250) {
      // Normal clicking - small fatigue
      s.fatigue = Math.min(1.0, s.fatigue + 0.03);
    } else if (timeSinceLastClick < 400) {
      // Slow clicking - minimal fatigue
      s.fatigue = Math.min(1.0, s.fatigue + 0.01);
    }
    // Very slow clicking (>400ms) = no fatigue added, lets you recover

    s.position += distance;

    // Update position in database (throttled)
    if (s.clickCount % 3 === 0 || s.position >= s.distance) {
      await supabaseClient
        .from("race_participants")
        .update({ position: s.position })
        .eq("id", s.participantId);
    }

    // Update local participant
    const myParticipant = s.participants.find(p => p.player_id === currentUser?.id);
    if (myParticipant) {
      myParticipant.position = s.position;
    }

    renderTrack();

    // Check if we finished
    if (s.position >= s.distance) {
      finishRace();
    }
  }

  async function finishRace() {
    const s = speedDashState;
    if (s.status === "finished") return;
    s.status = "finished";

    // Use fresh DOM ref
    const clickZoneEl = document.getElementById("dash-click-zone");
    if (clickZoneEl) {
      clickZoneEl.style.pointerEvents = "none";
      clickZoneEl.style.opacity = "0.5";
    }

    if (speedDashAnimId) {
      cancelAnimationFrame(speedDashAnimId);
      speedDashAnimId = null;
    }

    // Update our finish time
    await supabaseClient
      .from("race_participants")
      .update({ 
        position: s.distance,
        finished_at: new Date().toISOString(),
        placement: 1 
      })
      .eq("id", s.participantId);

    // Set us as winner in lobby
    await supabaseClient
      .from("race_lobbies")
      .update({ 
        status: "complete",
        winner_id: currentUser.id,
        finished_at: new Date().toISOString()
      })
      .eq("id", s.lobbyId)
      .eq("status", "racing"); // Only if still racing

    showResult(currentUser.id);
  }

  function checkForWinner() {
    const s = speedDashState;
    const winner = s.participants.find(p => p.position >= s.distance && p.finished_at);
    if (winner && s.status !== "finished") {
      s.status = "finished";
      showResult(winner.player_id);
    }
  }

  async function showResult(winnerId) {
    const s = speedDashState;
    s.status = "finished";

    // Use fresh DOM refs
    const clickZoneEl = document.getElementById("dash-click-zone");
    const resultEl = document.getElementById("dash-result");
    const resultTextEl = document.getElementById("dash-result-text");
    const playAgainBtn = document.getElementById("dash-play-again");
    const trackBadge = document.getElementById("track-provably-fair-badge");

    if (clickZoneEl) clickZoneEl.style.display = "none";
    
    // Hide the track badge - we'll show the one in results instead
    if (trackBadge) trackBadge.style.display = "none";
    
    // Hide play again button initially
    if (playAgainBtn) playAgainBtn.style.display = "none";

    if (speedDashAnimId) {
      cancelAnimationFrame(speedDashAnimId);
      speedDashAnimId = null;
    }
    cleanupSubscription();

    const isWinner = winnerId === currentUser?.id;
    const isCash = s.isCashMode;
    const entryAmount = isCash ? s.cashEntry : s.entryFee;
    const prize = isCash 
      ? (s.cashEntry * s.participants.length * 0.85).toFixed(2)
      : Math.floor(s.entryFee * s.participants.length * 0.85);
    const prizeLabel = isCash ? `$${prize}` : `${prize} coins`;
    const lossLabel = isCash ? `$${s.cashEntry.toFixed(2)}` : `${s.entryFee} coins`;

    // Reveal Provably Fair seed
    if (s.provablyFairId) {
      try {
        await ProvablyFair.revealGame(s.provablyFairId);
        console.log('[ProvablyFair] Game revealed');
      } catch (pfErr) {
        console.warn('[ProvablyFair] Could not reveal game:', pfErr);
      }
    }

    console.log('[SpeedDash] Race finished - isWinner:', isWinner, 'isCash:', isCash, 'prize:', prize, 'entryAmount:', entryAmount);
    
    if (isWinner) {
      // Credit prize
      if (isCash) {
        const cashPrize = parseFloat(prize);
        
        // Fetch CURRENT balance from DB (local value might be stale from render)
        const { data: currentProfile } = await supabaseClient
          .from("profiles")
          .select("cash_balance")
          .eq("id", currentUser.id)
          .single();
        const actualOldBalance = currentProfile?.cash_balance || 0;
        const newBalance = actualOldBalance + cashPrize;
        
        console.log('[SpeedDash] Cash payout - prize:', cashPrize, 'oldFromDB:', actualOldBalance, 'new:', newBalance);
        const { data: payoutData, error: cashErr } = await supabaseClient
          .from("profiles")
          .update({ cash_balance: newBalance })
          .eq("id", currentUser.id)
          .select("cash_balance")
          .single();
        if (cashErr) {
          console.error('[SpeedDash] Cash payout error:', cashErr);
        } else {
          console.log('[SpeedDash] Cash payout success:', payoutData);
          currentUser.cash_balance = payoutData?.cash_balance ?? newBalance;
          updateBalanceDisplay();
          
          // Record fee to fees_ledger for house accounting
          const totalEntry = s.cashEntry * s.participants.length;
          const feeAmount = totalEntry * 0.15;
          console.log('[SpeedDash] Recording fee:', { totalEntry, feeAmount, cashPrize, lobbyId: s.lobbyId });
          
          const { data: feeData, error: feeErr } = await supabaseClient.from("fees_ledger").insert({
            race_lobby_id: s.lobbyId,
            game_id: "speed-dash",
            total_entry: totalEntry,
            fee_amount: feeAmount,
            payout_amount: cashPrize,
            winner_id: currentUser.id,
            currency: "CASH"
          }).select();
          
          if (feeErr) {
            console.error('[SpeedDash] Failed to record fee:', feeErr.code, feeErr.message);
          } else {
            console.log('[SpeedDash] Fee recorded! House gets: $' + feeAmount.toFixed(2));
          }
          
          // Pay the fee to the house account
          const HOUSE_ACCOUNT_ID = "1a2b3c4d-5e6f-7081-9203-4b5c6d7e8f90";
          const { data: houseProfile } = await supabaseClient
            .from("profiles")
            .select("cash_balance")
            .eq("id", HOUSE_ACCOUNT_ID)
            .single();
          
          if (houseProfile) {
            const newHouseBalance = (houseProfile.cash_balance || 0) + feeAmount;
            const { error: houseErr } = await supabaseClient
              .from("profiles")
              .update({ cash_balance: newHouseBalance })
              .eq("id", HOUSE_ACCOUNT_ID);
            
            if (houseErr) {
              console.error('[SpeedDash] Failed to pay house:', houseErr.message);
            } else {
              console.log('[SpeedDash] House paid: $' + feeAmount.toFixed(2) + ' (new balance: $' + newHouseBalance.toFixed(2) + ')');
            }
          }
        }
      } else {
        await adjustCurrentUserCoinsNoRender(parseInt(prize));
        updateBalanceDisplay();
        
        // Record fee to fees_ledger for house accounting (coins)
        const totalEntry = s.entryFee * s.participants.length;
        const feeAmount = Math.round(totalEntry * 0.15);
        const { error: feeErr } = await supabaseClient.from("fees_ledger").insert({
          race_lobby_id: s.lobbyId,
          game_id: "speed-dash",
          total_entry: totalEntry,
          fee_amount: feeAmount,
          payout_amount: parseInt(prize),
          winner_id: currentUser.id,
          currency: "COIN"
        });
        if (feeErr) {
          console.error('[SpeedDash] Failed to record coin fee:', feeErr.code, feeErr.message);
        } else {
          console.log('[SpeedDash] Coin fee recorded! House gets:', feeAmount, 'coins');
        }
        
        // Pay the coin fee to the house account
        const HOUSE_ACCOUNT_ID = "1a2b3c4d-5e6f-7081-9203-4b5c6d7e8f90";
        const { data: houseProfile } = await supabaseClient
          .from("profiles")
          .select("coin_balance")
          .eq("id", HOUSE_ACCOUNT_ID)
          .single();
        
        if (houseProfile) {
          const newHouseBalance = (houseProfile.coin_balance || 0) + feeAmount;
          await supabaseClient
            .from("profiles")
            .update({ coin_balance: newHouseBalance })
            .eq("id", HOUSE_ACCOUNT_ID);
          console.log('[SpeedDash] House paid:', feeAmount, 'coins');
        }
      }
      if (resultTextEl) resultTextEl.innerHTML = `
        <span style="color:#22c55e;font-size:2rem;">🏆 YOU WON!</span><br>
        <span style="font-size:1.2rem;color:#4ade80;">+${prizeLabel}</span>
        ${s.serverSeedHash ? `<br><div style="margin-top:0.5rem;cursor:pointer;" onclick="showProvablyFairInfo('${s.serverSeedHash}', '${s.serverSeed}', '${s.lobbyId}')">${renderProvablyFairBadge(s.serverSeedHash, true)}</div>` : ''}
      `;
    } else {
      const winner = s.participants.find(p => p.player_id === winnerId);
      if (resultTextEl) resultTextEl.innerHTML = `
        <span style="color:#ef4444;font-size:2rem;">😢 YOU LOST</span><br>
        <span style="font-size:1.2rem;color:#f87171;">-${lossLabel}</span><br>
        <span style="color:#9ca3af;font-size:0.9rem;">@${winner?.username || "Opponent"} won</span>
        ${s.serverSeedHash ? `<br><div style="margin-top:0.5rem;cursor:pointer;" onclick="showProvablyFairInfo('${s.serverSeedHash}', '${s.serverSeed}', '${s.lobbyId}')">${renderProvablyFairBadge(s.serverSeedHash, true)}</div>` : ''}
      `;
    }
    
    // Show result immediately but delay the Play Again button by 3 seconds
    if (resultEl) resultEl.style.display = "block";
    
    setTimeout(() => {
      if (playAgainBtn) {
        playAgainBtn.style.display = "block";
      }
    }, 3000);
  }

  async function cancelRace() {
    const s = speedDashState;
    
    try {
      if (s.participantId) {
        await supabaseClient
          .from("race_participants")
          .delete()
          .eq("id", s.participantId);
      }

      if (s.lobbyId) {
        // Get current count and decrement
        const { data: lobby } = await supabaseClient
          .from("race_lobbies")
          .select("current_players")
          .eq("id", s.lobbyId)
          .single();
        
        if (lobby) {
          await supabaseClient
            .from("race_lobbies")
            .update({ current_players: Math.max(0, (lobby.current_players || 1) - 1) })
            .eq("id", s.lobbyId);
        }
      }

      // Refund entry
      if (s.isCashMode && s.cashEntry) {
        const { error: cashErr } = await supabaseClient
          .from("profiles")
          .update({ cash_balance: (currentUser.cash_balance || 0) + s.cashEntry })
          .eq("id", currentUser.id);
        if (!cashErr) {
          currentUser.cash_balance = (currentUser.cash_balance || 0) + s.cashEntry;
        }
      } else if (s.entryFee) {
        await adjustCurrentUserCoins(s.entryFee);
      }
      await loadCurrentUser();
    } catch (err) {
      console.error("Error cancelling race:", err);
    }

    cleanupSubscription();
    resetUI();
  }

  function resetUI() {
    speedDashState = {
      lobbyId: null,
      participantId: null,
      myLane: null,
      distance: 100,
      entryFee: 100,
      maxPlayers: 2,
      position: 0,
      participants: [],
      status: "idle",
      lastClickTime: 0,
      clickCount: 0,
      fatigue: 0,
    };

    lobbyEl.style.display = "block";
    lobbyEl.querySelector("h3").style.display = "";
    lobbyEl.querySelector("p").style.display = "";
    distanceSelect.parentElement.style.display = "";
    entrySelect.parentElement.style.display = "";
    findRaceBtn.style.display = "";
    findRaceBtn.disabled = false;
    findRaceBtn.textContent = "Find Race";
    waitingEl.style.display = "none";
    statusEl.textContent = "";

    raceEl.style.display = "none";
    resultEl.style.display = "none";
    clickZoneEl.style.display = "";
    clickZoneEl.style.pointerEvents = "auto";
    clickZoneEl.style.opacity = "1";
  }

  // Event listeners
  findRaceBtn.addEventListener("click", findOrCreateLobby);
  cancelBtn.addEventListener("click", cancelRace);
  clickZoneEl.addEventListener("click", handleClick);
  clickZoneEl.addEventListener("touchstart", (e) => {
    e.preventDefault();
    handleClick();
  });
  playAgainBtn.addEventListener("click", () => {
    // Preserve cash mode state before reset
    const wasCashMode = speedDashState?.isCashMode || dashCashMode;
    
    cleanupSubscription();
    resetUI();
    
    // Restore cash mode if it was active
    if (wasCashMode) {
      dashCashMode = true;
      const modeCoinBtn = document.getElementById("dash-mode-coin");
      const modeCashBtn = document.getElementById("dash-mode-cash");
      const coinControlsEl = document.getElementById("dash-coin-controls");
      const cashControlsEl = document.getElementById("dash-cash-controls");
      
      if (modeCashBtn) modeCashBtn.classList.add("active");
      if (modeCoinBtn) modeCoinBtn.classList.remove("active");
      if (coinControlsEl) coinControlsEl.style.display = "none";
      if (cashControlsEl) cashControlsEl.style.display = "";
      updateDashCashUI();
    }
  });
}

// --- Init ---
loadCurrentUser();

// Logo click → home
const homeLogo = document.querySelector(".logo");
if (homeLogo) {
  homeLogo.style.cursor = "pointer";
  homeLogo.addEventListener("click", () => {
    currentGameId = null;
    currentView = "hub";
    stopAllGames();
    render();
  });
}

document.addEventListener("fullscreenchange", () => {
  const btn = document.getElementById("game-fullscreen-toggle");
  if (btn) {
    if (document.fullscreenElement) {
      btn.setAttribute("aria-label", "Exit full screen");
      btn.setAttribute("title", "Exit full screen");
    } else {
      btn.setAttribute("aria-label", "Enter full screen");
      btn.setAttribute("title", "Enter full screen");
    }
  }

  const cards = document.querySelectorAll('[data-leaderboard-card="true"]');
  cards.forEach((card) => {
    if (document.fullscreenElement) {
      card.style.display = "none";
    } else {
      card.style.display = "";
    }
  });
});

// Removed debug hotkey now that Operator Dashboard exists.
