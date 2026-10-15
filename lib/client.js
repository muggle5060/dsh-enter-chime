/**
 * Browser half of `dsh-enter-chime`.
 *
 * Two Codex-style conveniences for the DSH Web UI, both client-side only:
 *
 * 1. Enter approves a pending approval. The approval composer takeover only
 *    answers Enter while focus is inside its own panel, so this half (a) moves
 *    focus to the panel when it appears and (b) answers Enter itself whenever
 *    the panel is on screen but focus sits somewhere else.
 * 2. A chime (and, when the window is in the background, a desktop
 *    notification) when the reply in the main view finishes. The signal is the
 *    Client session-status projection: a `running` edge from true to false on a
 *    session that is not marked `completionUnread` is exactly "the conversation
 *    you are looking at stopped working".
 *
 * Preferences live in `localStorage["dsh.enter-chime.v1"]`:
 *   { "enter": true, "chime": true, "notify": true, "volume": 0.3 }
 */

window.__ModuleLoader__.load({
	id: "dsh-enter-chime",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const VERSION = "0.1.0";
		const PREF_KEY = "dsh.enter-chime.v1";
		const DEFAULTS = { enter: true, chime: true, notify: true, volume: 0.3 };
		/** Pending approvals render one root carrying this attribute. */
		const APPROVAL_ROOT = "[data-approval-key]";
		/** Controls that own Enter themselves; never steal the key from them. */
		const EDITABLE = "input, textarea, select, [contenteditable=\"true\"], [contenteditable=\"\"]";
		/** Focus target inside the approval panel (role=group, tabIndex 0). */
		const APPROVAL_FOCUS = "[data-approval-scroll]";
		/** Completion cue: C6 then G6, short, sine, no asset files. */
		const TONES = [
			[1046.5, 0],
			[1568, 0.13]
		];

		function readPrefs() {
			const value = { ...DEFAULTS };
			try {
				const raw = window.localStorage.getItem(PREF_KEY);
				if (raw === null) return value;
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object") return value;
				for (const key of Object.keys(DEFAULTS)) {
					if (typeof parsed[key] === typeof DEFAULTS[key]) value[key] = parsed[key];
				}
			} catch (error) { /* unreadable preferences fall back to defaults */ }
			return value;
		}

		function writePrefs(patch) {
			const next = { ...readPrefs(), ...patch };
			try {
				window.localStorage.setItem(PREF_KEY, JSON.stringify(next));
			} catch (error) { /* a blocked storage keeps the in-memory behaviour */ }
			return next;
		}

		// #region Enter approves

		/** The approval panel currently on screen, or null. */
		function pendingApproval() {
			const roots = document.querySelectorAll(APPROVAL_ROOT);
			return roots.length === 0 ? null : roots[roots.length - 1];
		}

		/** An answered panel keeps its buttons disabled while it settles. */
		function answering(root) {
			return root.getAttribute("aria-busy") === "true";
		}

		/**
		 * The "allow once" action. The panel renders reject then allow in its
		 * action row, so the last enabled button is the primary one; a localized
		 * label match guards against a Tool-owned detail appending its own
		 * controls after that row.
		 */
		function allowButton(root) {
			const enabled = [...root.querySelectorAll("button")].filter((button) => !button.disabled);
			if (enabled.length === 0) return null;
			const labelled = enabled.filter((button) => /allow|允许|許可|허용|permitir|autoriser|erlauben/i.test(button.textContent ?? ""));
			return labelled.length > 0 ? labelled[labelled.length - 1] : enabled[enabled.length - 1];
		}

		/** Answer the panel the way its own Enter handler would. */
		function answerApproval(root) {
			const button = allowButton(root);
			if (button === null) return false;
			button.click();
			return true;
		}

		/**
		 * Focus the panel so its built-in Enter/Esc handling is reachable. The
		 * takeover replaces the composer, so focus normally falls back to the
		 * document body; focus already inside the panel, or on a control the user
		 * is working in elsewhere, is never stolen.
		 */
		function focusApproval(root) {
			const active = document.activeElement;
			if (active !== null && root.contains(active)) return;
			if (active instanceof Element && active !== document.body && active.closest(EDITABLE) !== null) return;
			const target = root.querySelector(APPROVAL_FOCUS) ?? root;
			if (typeof target.focus !== "function") return;
			try {
				target.focus({ preventScroll: false });
			} catch (error) { /* a non-focusable panel still answers Enter below */ }
		}

		function installApprovalEnter() {
			let scheduled = false;
			let focusedKey = null;

			const scan = () => {
				scheduled = false;
				const root = pendingApproval();
				if (root === null || answering(root)) return;
				const key = root.getAttribute("data-approval-key");
				if (key !== null && key === focusedKey && root.contains(document.activeElement)) return;
				focusedKey = key;
				focusApproval(root);
			};

			const schedule = () => {
				if (scheduled) return;
				scheduled = true;
				if (typeof requestAnimationFrame === "function") requestAnimationFrame(scan);
				else setTimeout(scan, 0);
			};

			const onKeydown = (event) => {
				if (event.defaultPrevented || event.key !== "Enter") return;
				if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
				if (event.repeat || event.isComposing || event.keyCode === 229) return;
				/* No pending panel means this listener has no opinion at all. */
				const root = pendingApproval();
				if (root === null || answering(root)) return;
				if (!readPrefs().enter) return;
				const target = event.target;
				if (target instanceof Element && target.closest(EDITABLE) !== null) return;
				const active = document.activeElement;
				if (target instanceof Element && root.contains(target) && active !== null && root.contains(active)) return;
				if (!answerApproval(root)) return;
				event.preventDefault();
				event.stopPropagation();
			};

			const observer = new MutationObserver(schedule);
			observer.observe(document.documentElement, { childList: true, subtree: true });
			document.addEventListener("keydown", onKeydown, false);
			scan();

			return () => {
				observer.disconnect();
				document.removeEventListener("keydown", onKeydown, false);
			};
		}

		// #endregion

		// #region Completion chime and notification

		let audio = null;

		function audioContext() {
			if (audio !== null) return audio;
			const Ctor = window.AudioContext ?? window.webkitAudioContext;
			if (typeof Ctor !== "function") return null;
			try {
				audio = new Ctor();
			} catch (error) {
				audio = null;
			}
			return audio;
		}

		/** Browsers gate audio on a user gesture; warm the context on the first one. */
		function unlockAudio() {
			const context = audioContext();
			if (context !== null && context.state === "suspended") context.resume().catch(() => {});
		}

		function playChime() {
			const prefs = readPrefs();
			if (!prefs.chime) return;
			const context = audioContext();
			if (context === null) return;
			const emit = () => {
				const origin = context.currentTime + 0.02;
				for (const [frequency, delay] of TONES) {
					const oscillator = context.createOscillator();
					const gain = context.createGain();
					oscillator.type = "sine";
					oscillator.frequency.value = frequency;
					const at = origin + delay;
					gain.gain.setValueAtTime(0.0001, at);
					gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, prefs.volume), at + 0.015);
					gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
					oscillator.connect(gain);
					gain.connect(context.destination);
					oscillator.start(at);
					oscillator.stop(at + 0.45);
				}
			};
			if (context.state === "suspended") context.resume().then(emit, () => {});
			else emit();
		}

		/** Body copy used only when the finished turn left no readable text. */
		function fallbackCopy() {
			return /^zh/i.test(window.navigator?.language ?? "") ? "回答已完成" : "Reply finished";
		}

		/** Text blocks of one assembled assistant message. */
		function contentText(content) {
			if (!Array.isArray(content)) return "";
			const parts = [];
			for (const block of content) {
				if (typeof block === "string") {
					parts.push(block);
					continue;
				}
				if (block === null || typeof block !== "object") continue;
				if (block.type !== undefined && block.type !== "text") continue;
				const value = typeof block.text === "string" ? block.text : typeof block.value === "string" ? block.value : "";
				if (value !== "") parts.push(value);
			}
			return parts.join("\n\n").trim();
		}

		/** Durable-stream fallback: `text-chunks` records carry the reply's string runs. */
		function streamText(stream) {
			if (!Array.isArray(stream)) return "";
			let text = "";
			for (const record of stream) {
				if (record === null || typeof record !== "object") continue;
				if (record.type === "text-chunks" && Array.isArray(record.texts)) text += record.texts.join("");
			}
			return text.trim();
		}

		/**
		 * Text of the last assistant reply in one Session, read from the borrowed
		 * binding's visible event window (loaded history plus live tail).
		 *
		 * The scan stops at `turn/start`, so a turn that produced no text at all
		 * falls back to the canned copy instead of reusing an earlier reply.
		 * `sessions.binding()` borrows an already-retained binding without
		 * extending its lifetime, so reading a finished turn costs no retention.
		 */
		function lastReplyText(sessions, sessionId) {
			const entries = sessions?.binding?.(sessionId)?.eventSource?.getSnapshot?.()?.entries;
			if (!Array.isArray(entries)) return "";
			for (let index = entries.length - 1; index >= 0; index -= 1) {
				const event = entries[index]?.event;
				if (event?.type === "turn/start") break;
				if (event?.type !== "assistant/message") continue;
				const data = event.data ?? {};
				const assembled = contentText(data.message?.content);
				if (assembled !== "") return assembled;
				const streamed = streamText(data.stream);
				if (streamed !== "") return streamed;
			}
			return "";
		}

		/** Notification bodies are one short plain-text line. */
		const NOTIFICATION_LIMIT = 180;

		/** Strip the markdown that a toast cannot render, then cap the length. */
		function preview(text) {
			const flat = String(text ?? "")
				.replace(/```[\s\S]*?```/g, " ")
				.replace(/`([^`]*)`/g, "$1")
				.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
				.replace(/\*\*|__|~~/g, "")
				.replace(/^#{1,6}\s+/gm, "")
				.replace(/\s+/g, " ")
				.trim();
			return flat.length <= NOTIFICATION_LIMIT ? flat : `${flat.slice(0, NOTIFICATION_LIMIT - 1)}…`;
		}

		function notifyCompletion(sessions, sessionId) {
			const prefs = readPrefs();
			if (!prefs.notify) return;
			/* A focused window already shows the answer; only background turns alert. */
			if (document.visibilityState === "visible" && document.hasFocus()) return;
			const body = preview(lastReplyText(sessions, sessionId)) || fallbackCopy();
			const Ctor = window.Notification;
			if (typeof Ctor !== "function") return;
			const show = () => {
				try {
					new Ctor("DeepSeek Harness", {
						body,
						tag: "dsh-enter-chime",
						silent: true
					});
				} catch (error) { /* notifications may be unavailable in this shell */ }
			};
			if (Ctor.permission === "granted") show();
			else if (Ctor.permission === "default") {
				try {
					const asked = Ctor.requestPermission();
					if (asked !== null && typeof asked.then === "function") asked.then((granted) => {
						if (granted === "granted") show();
					}, () => {});
				} catch (error) { /* a refused prompt is not an error */ }
			}
		}

		/**
		 * Chime when the session shown in the main view stops running.
		 *
		 * `uiSession.sessionStatus` marks a finished session `completionUnread`
		 * only when it is *not* retained by the main view, so a true->false
		 * `running` edge without that mark is the conversation on screen.
		 */
		function watchCompletions(scope) {
			const status = scope.uiSession?.sessionStatus;
			if (status === undefined) return () => {};
			const running = new Map();
			for (const [id, value] of status.getSnapshot()) running.set(id, value?.running === true);
			return status.subscribe(() => {
				for (const [id, value] of status.getSnapshot()) {
					const before = running.get(id);
					const now = value?.running === true;
					running.set(id, now);
					if (before !== true || now !== false) continue;
					if (value?.completionUnread === true) continue;
					playChime();
					notifyCompletion(scope.sessions, id);
				}
			});
		}

		// #endregion

		/** This package hard-depends on nothing; the completion watch waits for `uiSession`. */
		const inject = [];

		function apply(ctx) {
			ctx.effect(() => installApprovalEnter(), "enter-chime: approval Enter");
			ctx.effect(() => {
				const listener = () => {
					unlockAudio();
					document.removeEventListener("pointerdown", listener, true);
					document.removeEventListener("keydown", listener, true);
				};
				document.addEventListener("pointerdown", listener, true);
				document.addEventListener("keydown", listener, true);
				return () => {
					document.removeEventListener("pointerdown", listener, true);
					document.removeEventListener("keydown", listener, true);
				};
			}, "enter-chime: audio unlock");
			ctx.inject(["uiSession", "sessions"], (scope) => {
				scope.effect(() => watchCompletions(scope), "enter-chime: completion watch");
			});
			/* Debug handle: lets the settings-free preferences be changed live. */
			window.__dshEnterChime = {
				version: VERSION,
				prefs: readPrefs,
				setPrefs: writePrefs,
				chime: playChime,
				/** Exactly what a background completion would put in the toast. */
				preview
			};
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
