// --- PWA install button + service worker registration ---
// Self-contained: does not depend on main.js internals.

(function () {
  let deferredPrompt = null;

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  }

  function renderButton() {
    const container = document.getElementById("pwa-install-container");
    if (!container) return;

    if (isStandalone()) {
      container.innerHTML = "";
      return;
    }

    if (!deferredPrompt && !isIos()) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = `
      <button id="pwa-install-btn" class="btn btn-secondary" title="Install Arcade Hub as an app" style="padding:0.5rem 0.9rem;font-size:0.82rem;">
        Add to Home Screen
      </button>
    `;

    const btn = document.getElementById("pwa-install-btn");
    if (btn) {
      btn.addEventListener("click", handleInstallClick);
    }
  }

  async function handleInstallClick() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch (e) {
        /* ignore */
      }
      deferredPrompt = null;
      renderButton();
      return;
    }

    if (isIos()) {
      showIosInstructions();
    }
  }

  function showIosInstructions() {
    const existing = document.getElementById("pwa-ios-modal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "pwa-ios-modal";
    overlay.className = "auth-modal-overlay";
    overlay.innerHTML = `
      <div class="auth-modal" style="max-width:340px;">
        <div class="auth-modal-header">
          <div class="auth-modal-title">Add to Home Screen</div>
          <button class="auth-modal-close" id="pwa-ios-close">&times;</button>
        </div>
        <div class="small-text" style="line-height:1.6;">
          1. Tap the <strong>Share</strong> icon in Safari's toolbar<br/>
          2. Scroll down and tap <strong>"Add to Home Screen"</strong><br/>
          3. Tap <strong>Add</strong> — Arcade Hub will appear on your home screen like an app.
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById("pwa-ios-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    renderButton();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    renderButton();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderButton);
  } else {
    renderButton();
  }

  // Re-check periodically in case #pwa-install-container gets re-rendered by main.js
  setInterval(renderButton, 2000);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* ignore registration failures (e.g. running from file://) */
      });
    });
  }
})();
