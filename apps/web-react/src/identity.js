const GUEST_STORAGE_KEY = "spark.guest.identity.v1";
const adjectives = [
  "Copper",
  "Pixel",
  "Quartz",
  "Moss",
  "Ember",
  "Cobalt",
  "Lunar",
  "Cedar",
  "Echo",
  "Velvet",
];
const creatures = [
  "Otter",
  "Fox",
  "Moth",
  "Badger",
  "Raven",
  "Gecko",
  "Panda",
  "Falcon",
  "Axolotl",
  "Bee",
];

let clerkLoadState = "idle"; // idle | loading | ready | error
let clerkReadyPromise = null;

function createGuestName() {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const creature = creatures[Math.floor(Math.random() * creatures.length)];
  // Keep guest names compact while using crypto randomness for the suffix.
  // The adjective/creature pair plus three base-36 characters gives a large
  // readable namespace without exposing a long identifier.
  const entropy = new Uint32Array(1);
  crypto.getRandomValues(entropy);
  const suffix = (entropy[0] % 36 ** 3)
    .toString(36)
    .toUpperCase()
    .padStart(3, "0");
  return `${adjective}${creature}_${suffix}`;
}

function createSparkAlias() {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const creature = creatures[Math.floor(Math.random() * creatures.length)];
  return `${adjective}${creature}`;
}

function readGuest() {
  try {
    const identity = JSON.parse(localStorage.getItem(GUEST_STORAGE_KEY));
    if (!identity) return null;
    if (!identity.id) {
      identity.id = crypto.randomUUID();
      localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(identity));
    }
    return identity;
  } catch {
    return null;
  }
}

function saveGuest(displayName) {
  const current = readGuest();
  const identity = {
    id: current?.id ?? crypto.randomUUID(),
    kind: "guest",
    displayName,
    createdAt: current?.createdAt ?? new Date().toISOString(),
  };
  localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function getCurrentIdentity() {
  return readGuest();
}

export function ensureGuestIdentity() {
  return readGuest() ?? saveGuest(createGuestName());
}

function clerkKey() {
  const script = document.querySelector("script[data-clerk-publishable-key]");
  const value = script?.getAttribute("data-clerk-publishable-key")?.trim();
  return value && value !== "__CLERK_PUBLISHABLE_KEY__" ? value : "";
}

function deriveClerkFapiUrl(publishableKey) {
  try {
    const encoded = publishableKey.split("_")[2];
    if (!encoded) return "";
    const decoded = atob(encoded);
    return decoded.replace(/\$+$/, "");
  } catch {
    return "";
  }
}

function loadClerkUIBundle(fapiUrl) {
  return new Promise((resolve, reject) => {
    if (window.__internal_ClerkUICtor) {
      resolve();
      return;
    }
    if (!fapiUrl) {
      reject(
        new Error(
          "Could not derive Clerk frontend API URL from publishable key.",
        ),
      );
      return;
    }

    const existing = document.querySelector("script[data-clerk-ui-bundle]");
    if (existing) {
      if (window.__internal_ClerkUICtor) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Clerk UI bundle failed to load.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = `https://${fapiUrl}/npm/@clerk/ui@1/dist/ui.browser.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.clerkUiBundle = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Failed to load Clerk UI bundle.")),
      { once: true },
    );
    document.head.appendChild(script);
  });
}

async function waitForClerk(maxWaitMs = 15000) {
  if (clerkReadyPromise) return clerkReadyPromise;

  clerkReadyPromise = new Promise(async (resolve) => {
    const key = clerkKey();
    if (!key) {
      clerkLoadState = "error";
      console.warn("[Spark] No Clerk publishable key found.");
      resolve(null);
      return;
    }

    clerkLoadState = "loading";
    const start = Date.now();
    const fapiUrl = deriveClerkFapiUrl(key);

    // The Clerk browser bundle auto-creates window.Clerk from the script tag's
    // data-clerk-publishable-key, but we still have to call load() ourselves.
    // Clerk v6 also requires the separate @clerk/ui bundle for openSignIn/openUserProfile.
    while (true) {
      const clerk = window.Clerk;
      if (clerk && !clerk.loaded && !clerk.__sparkLoading) {
        clerk.__sparkLoading = true;
        try {
          await loadClerkUIBundle(fapiUrl);
          await clerk.load({
            ui: window.__internal_ClerkUICtor
              ? { ClerkUI: window.__internal_ClerkUICtor }
              : undefined,
          });
        } catch (error) {
          clerkLoadState = "error";
          console.error("[Spark] Clerk.load() failed:", error);
          resolve(null);
          return;
        }
      }
      if (clerk?.loaded) {
        clerkLoadState = "ready";
        console.log(
          "[Spark] Clerk ready. User:",
          clerk.user ? clerk.user.id : "signed out",
        );
        resolve(clerk);
        return;
      }
      if (Date.now() - start > maxWaitMs) {
        clerkLoadState = "error";
        console.error(
          "[Spark] Clerk did not load within timeout. Check the publishable key and network.",
        );
        resolve(null);
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  return clerkReadyPromise;
}

export async function getClerk() {
  return waitForClerk();
}

export function getClerkLoadState() {
  return clerkLoadState;
}

export async function isAuthenticated() {
  const clerk = await getClerk();
  return Boolean(clerk?.user);
}

export async function getAuthHeaders() {
  const clerk = await getClerk();
  const token = clerk?.user ? await clerk.session?.getToken() : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function getActiveIdentity() {
  const clerk = await getClerk();
  if (clerk?.user) {
    return {
      kind: "account",
      id: `clerk:${clerk.user.id}`,
      displayName: displayNameForClerkUser(clerk.user),
      verified: true,
      avatarUrl: clerk.user.imageUrl,
    };
  }
  return ensureGuestIdentity();
}

function clerkHandle(user) {
  if (user?.username) return user.username;
  const email = user?.primaryEmailAddress?.emailAddress;
  if (email) return email.split("@")[0] ?? email;
  return null;
}

function displayNameForClerkUser(user) {
  const custom = user?.unsafeMetadata?.sparkDisplayName;
  if (custom) return String(custom);
  return clerkHandle(user) || user?.fullName || "Member";
}

function originalDisplayNameForClerkUser(user) {
  return clerkHandle(user) || user?.fullName || "Member";
}

function providerLabelForClerkUser(user) {
  const accounts = user?.externalAccounts ?? [];
  if (!accounts.length) return "Spark account";
  return accounts
    .map((account) => {
      const p = account.provider;
      if (p === "oauth_google") return "Google";
      if (p === "oauth_github") return "GitHub";
      if (p === "oauth_discord") return "Discord";
      if (p === "oauth_x") return "X";
      return p.replace("oauth_", "");
    })
    .join(", ");
}

function openAccountPanel(clerk) {
  const user = clerk.user;
  if (!user) return;

  const existing = document.querySelector(".account-panel-dialog");
  if (existing) {
    existing.close();
    existing.remove();
  }

  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const customName = user.unsafeMetadata?.sparkDisplayName ?? "";
  const originalName = originalDisplayNameForClerkUser(user);

  const dialog = document.createElement("dialog");
  dialog.className = "account-panel-dialog";
  dialog.setAttribute("aria-labelledby", "account-panel-title");
  dialog.innerHTML = `
    <div class="account-panel">
      <button class="account-panel-close" type="button" aria-label="Close account panel">×</button>
      <div class="account-panel-banner" aria-hidden="true"></div>
      <div class="account-panel-avatar-wrap">
        <img class="account-panel-avatar" src="${user.imageUrl || "/favicon.svg"}" alt="" />
      </div>
      <div class="account-panel-body">
        <div class="account-panel-header">
          <div class="account-panel-name-row">
            <strong class="account-panel-name">${displayNameForClerkUser(user)}</strong>
          <span class="verified-badge large" title="Verified identity" aria-label="Verified Spark identity"></span>
          </div>
        </div>

        <div class="account-panel-details">
          <div class="account-panel-row">
            <span>Full name</span>
            <strong>${user.fullName || "—"}</strong>
          </div>
          <div class="account-panel-row">
            <span>Email</span>
            <strong>${email || "—"}</strong>
          </div>
          <div class="account-panel-row">
            <span>Original handle</span>
            <strong>${originalName}</strong>
          </div>
        </div>

        <form class="account-panel-name-form">
          <div class="account-panel-alias-head">
            <span>Spark alias</span>
            <button class="account-panel-alias-reroll" type="button">↻ Reroll</button>
          </div>
          <div class="account-panel-alias-preview"><span class="account-panel-alias-cube" aria-hidden="true"></span><strong class="account-panel-name-input">${customName || originalName}</strong></div>
          <p class="account-panel-name-hint">Pick a name from Spark’s aliases. Your provider handle stays private as your verified origin.</p>
          <div class="account-panel-name-actions">
            <button class="account-panel-name-clear" type="button">Use original</button>
            <button class="account-panel-name-save" type="submit">Save alias</button>
          </div>
          <p class="account-panel-name-status" role="status" aria-live="polite"></p>
        </form>
      </div>

      <button class="account-panel-logout" type="button">Log out</button>
    </div>`;
  document.body.append(dialog);

  const nameForm = dialog.querySelector(".account-panel-name-form");
  const nameInput = dialog.querySelector(".account-panel-name-input");
  const aliasReroll = dialog.querySelector(".account-panel-alias-reroll");
  const nameStatus = dialog.querySelector(".account-panel-name-status");
  const nameSave = dialog.querySelector(".account-panel-name-save");
  const nameClear = dialog.querySelector(".account-panel-name-clear");

  let aliasCandidate = customName || originalName;

  function renderAliasCandidate() {
    nameInput.textContent = aliasCandidate;
  }

  async function saveDisplayName(value) {
    nameSave.disabled = true;
    nameSave.textContent = "Saving…";
    nameStatus.textContent = "";
    try {
      const trimmed = value.trim();
      if (trimmed) {
        const token = await clerk.session?.getToken();
        const reservation = await fetch("/api/v1/identity/display-name", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ displayName: trimmed }),
        });
        if (!reservation.ok) {
          nameStatus.textContent =
            reservation.status === 409
              ? "That alias is already taken. Reroll for another."
              : reservation.status === 401
                ? "Your session expired. Sign in again to save an alias."
                : reservation.status === 503
                  ? "Alias storage is offline. Start Spark with PostgreSQL enabled."
                  : "Spark could not reserve this alias. Try again.";
          return;
        }
      }
      const nextUnsafeMetadata = {
        ...user.unsafeMetadata,
        sparkDisplayName: trimmed || undefined,
      };
      if (!trimmed) delete nextUnsafeMetadata.sparkDisplayName;
      await user.update({ unsafeMetadata: nextUnsafeMetadata });
      nameStatus.textContent = trimmed
        ? "Display name saved."
        : "Display name reset to original.";
      window.dispatchEvent(
        new CustomEvent("spark:identity-changed", {
          detail: {
            kind: "account",
            id: `clerk:${user.id}`,
            displayName: displayNameForClerkUser(user),
            verified: true,
          },
        }),
      );
      setTimeout(() => dialog.close(), 450);
    } catch (error) {
      console.error("[Spark] Could not update display name:", error);
      nameStatus.textContent = "Could not save display name. Try again.";
    } finally {
      nameSave.disabled = false;
      nameSave.textContent = "Save alias";
    }
  }

  nameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveDisplayName(aliasCandidate);
  });
  aliasReroll.addEventListener("click", () => {
    aliasCandidate = createSparkAlias();
    renderAliasCandidate();
    nameStatus.textContent = "New alias ready to save.";
  });
  nameClear.addEventListener("click", async () => {
    aliasCandidate = originalName;
    renderAliasCandidate();
    await saveDisplayName("");
  });

  dialog
    .querySelector(".account-panel-close")
    .addEventListener("click", () => dialog.close());
  dialog
    .querySelector(".account-panel-logout")
    .addEventListener("click", async () => {
      await clerk.signOut();
      dialog.close();
    });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

export function setupIdentity() {
  const trigger = document.querySelector(".sign");
  if (!trigger) return;

  const dialog = document.createElement("dialog");
  dialog.className = "identity-dialog";
  dialog.setAttribute("aria-labelledby", "identity-title");
  dialog.innerHTML = `
    <div class="identity-art" aria-hidden="true">
      <img src="/identity-portal.png" alt="" />
      <p>Step through the portal.<br />The commons is waiting inside.</p>
    </div>
    <section class="identity-panel">
      <button class="identity-close" type="button" aria-label="Close identity window">×</button>
      <div class="identity-kicker">CHOOSE YOUR NAMEPLATE</div>
      <h2 id="identity-title">Enter the commons</h2>
      <p class="identity-intro">Read and contribute immediately. Sign in only when you want one identity everywhere.</p>

      <div class="provider-list" aria-label="Sign in providers">
        <button class="provider" type="button" data-provider="github" disabled>
          <span class="provider-icon-wrap" aria-hidden="true">
            <svg class="provider-icon" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
          </span>
          <span class="provider-label">GitHub</span>
        </button>
        <button class="provider" type="button" data-provider="google" disabled>
          <span class="provider-icon-wrap" aria-hidden="true">
            <svg class="provider-icon google" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          </span>
          <span class="provider-label">Google</span>
        </button>
        <button class="provider" type="button" data-provider="x" disabled>
          <span class="provider-icon-wrap" aria-hidden="true">
            <svg class="provider-icon" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </span>
          <span class="provider-label">X</span>
        </button>
        <button class="provider" type="button" data-provider="discord" disabled>
          <span class="provider-icon-wrap" aria-hidden="true">
            <svg class="provider-icon" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          </span>
          <span class="provider-label">Discord</span>
        </button>
      </div>

      <div class="identity-divider"><span>or join as a guest</span></div>
      <div class="guest-card">
        <div class="guest-head"><span class="guest-cube" aria-hidden="true"></span><div><small>YOUR RANDOM NAME</small><strong class="guest-name"></strong></div></div>
        <span class="guest-fixed">LOCKED IN</span>
      </div>
      <button class="guest-continue" type="button">Continue as guest →</button>
      <p class="identity-note">Guest activity stays with this browser. Sign in whenever you want the same identity on another device.</p>
      <p class="identity-status" role="status" aria-live="polite"></p>
    </section>`;
  document.body.append(dialog);

  const close = dialog.querySelector(".identity-close");
  const guestName = dialog.querySelector(".guest-name");
  const continueGuest = dialog.querySelector(".guest-continue");
  const status = dialog.querySelector(".identity-status");
  const providerButtons = dialog.querySelectorAll("[data-provider]");
  let proposedGuestName = readGuest()?.displayName || createGuestName();

  function renderGuestName() {
    guestName.textContent = proposedGuestName;
  }

  function renderTrigger(identity) {
    const visibleIdentity = identity ?? ensureGuestIdentity();
    trigger.textContent = visibleIdentity.displayName;
    trigger.classList.add("has-identity");
    trigger.dataset.kind = visibleIdentity.kind;
    if (visibleIdentity.avatarUrl)
      trigger.style.setProperty(
        "--spark-avatar",
        `url("${visibleIdentity.avatarUrl}")`,
      );
    else trigger.style.removeProperty("--spark-avatar");
  }

  const providerStrategies = {
    github: "oauth_github",
    google: "oauth_google",
    x: "oauth_x",
    discord: "oauth_discord",
  };

  function setProviderLoading(provider, loading) {
    const button = Array.from(providerButtons).find(
      (btn) => btn.dataset.provider === provider,
    );
    if (!button) return;
    button.disabled = loading;
    button.classList.toggle("provider-loading", loading);
    const label = button.querySelector(".provider-label");
    const displayNames = {
      github: "GitHub",
      google: "Google",
      x: "X",
      discord: "Discord",
    };
    if (label)
      label.textContent = loading
        ? "Connecting…"
        : (displayNames[provider] ?? provider);
  }

  function setAllProvidersDisabled(disabled) {
    providerButtons.forEach((button) => (button.disabled = disabled));
  }

  async function startClerkSignIn(provider) {
    status.textContent = "";
    setAllProvidersDisabled(true);
    setProviderLoading(provider, true);

    const clerk = await getClerk();
    if (!clerk) {
      status.textContent =
        "Social sign-in is not configured. Check CLERK_PUBLISHABLE_KEY or continue as a guest.";
      setProviderLoading(provider, false);
      setAllProvidersDisabled(false);
      return;
    }

    if (clerk.user) {
      dialog.close();
      openAccountPanel(clerk);
      return;
    }

    const origin = window.location.origin
      .replace("http://127.0.0.1:", "http://localhost:")
      .replace("https://127.0.0.1:", "https://localhost:");
    const callbackUrl = `${origin}/sso-callback`;
    const redirectUrl = `${origin}/`;
    const strategy = providerStrategies[provider];
    dialog.close();

    try {
      // Start the selected provider directly. The callback route below calls
      // Clerk.handleRedirectCallback(), including sign-in -> sign-up transfer.
      await clerk.client.signIn.authenticateWithRedirect({
        strategy,
        redirectUrl: callbackUrl,
        redirectUrlComplete: redirectUrl,
        signUpFallbackRedirectUrl: redirectUrl,
        signUpForceRedirectUrl: redirectUrl,
        signInFallbackRedirectUrl: redirectUrl,
        signInForceRedirectUrl: redirectUrl,
        transferable: true,
      });
    } catch (error) {
      console.error(
        `[Spark] Clerk sign-in-or-sign-up could not start for ${provider}:`,
        error,
      );
      status.textContent =
        "Sign-in could not start. Try again or continue as a guest.";
      setProviderLoading(provider, false);
      setAllProvidersDisabled(false);
    }
  }

  renderGuestName();
  // Give every visitor a stable local identity immediately. Clerk replaces
  // it with the verified account identity after authentication.
  renderTrigger(ensureGuestIdentity());

  // Wait for Clerk and wire up auth state changes.
  getClerk()
    .then((clerk) => {
      if (!clerk) {
        status.textContent =
          "Social sign-in is not configured. Guest access is ready now.";
        return;
      }
      setAllProvidersDisabled(false);
      if (window.location.pathname === "/sso-callback") {
        clerk
          .handleRedirectCallback({
            signInUrl: `${window.location.origin}/`,
            signUpUrl: `${window.location.origin}/`,
            signInForceRedirectUrl: `${window.location.origin}/`,
            signUpForceRedirectUrl: `${window.location.origin}/`,
            transferable: true,
          })
          .catch((error) => {
            console.error("[Spark] Clerk OAuth callback failed:", error);
            window.location.replace("/");
          });
      }
      const syncClerkIdentity = (candidate) => {
        const user = candidate ?? clerk.user;
        if (user) {
          const identity = {
            kind: "account",
            id: `clerk:${user.id}`,
            displayName: displayNameForClerkUser(user),
            verified: true,
            avatarUrl: user.imageUrl,
          };
          renderTrigger(identity);
          window.dispatchEvent(
            new CustomEvent("spark:identity-changed", { detail: identity }),
          );
        } else {
          const guest = ensureGuestIdentity();
          renderTrigger(guest);
          window.dispatchEvent(
            new CustomEvent("spark:identity-changed", { detail: guest }),
          );
        }
      };
      clerk.addListener((payload) => syncClerkIdentity(payload?.user));
      syncClerkIdentity(clerk.user);
    })
    .catch((error) => {
      console.error("[Spark] Clerk setup failed:", error);
      status.textContent =
        "Sign-in could not load. Guest access is still available.";
    });

  trigger.addEventListener("click", async () => {
    const clerk = await getClerk();
    if (clerk?.user) {
      openAccountPanel(clerk);
      return;
    }
    status.textContent =
      clerkLoadState === "loading" ? "Warming up the sign-in portal…" : "";
    setAllProvidersDisabled(clerkLoadState !== "ready");
    dialog.showModal();
  });

  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  continueGuest.addEventListener("click", () => {
    const identity = saveGuest(proposedGuestName);
    renderTrigger(identity);
    dialog.close();
    window.dispatchEvent(
      new CustomEvent("spark:identity-changed", { detail: identity }),
    );
  });
  providerButtons.forEach((button) =>
    button.addEventListener("click", () =>
      startClerkSignIn(button.dataset.provider),
    ),
  );
}
