// React-powered live chat renderer (read-only); plugs into existing Supabase events.
// Falls back silently if React is unavailable.
(function () {
    const PLACEHOLDER_AVATAR = "https://placehold.co/32";

    function createStore() {
        let messages = [];
        const subs = new Set();
        const notify = () => subs.forEach((fn) => fn(messages));
        return {
            replace(newList) {
                messages = Array.isArray(newList) ? [...newList] : [];
                notify();
            },
            push(msg) {
                messages = [...messages, msg];
                notify();
            },
            get() {
                return messages;
            },
            subscribe(fn) {
                subs.add(fn);
                fn(messages);
                return () => subs.delete(fn);
            },
        };
    }

    const store = createStore();
    window.liveChatStore = store;

    function formatTime(ts) {
        if (!ts) return "";
        const d = new Date(ts);
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function mountReact() {
        if (!window.React || !window.ReactDOM) return;
        const rootEl = document.getElementById("stream-chat-messages");
        if (!rootEl) return;

        const e = React.createElement;
        const { useEffect, useState } = React;

        function useChatMessages() {
            const [list, setList] = useState(store.get());
            useEffect(() => store.subscribe(setList), []);
            return list;
        }

        function ChatMessage({ msg }) {
            const isOwn = msg.user_id && msg.user_id === window.currentUser?.id;
            const className = "chat-message" + (isOwn ? " own-message" : "");
            const username =
                msg.users?.name || msg.user_name || "Utilisateur";
            const userId = msg.users?.id || msg.user_id;
            const usernameHtml =
                typeof window.renderUsernameWithBadge === "function" && userId
                    ? window.renderUsernameWithBadge(username, userId)
                    : username;
            const avatar = msg.users?.avatar || PLACEHOLDER_AVATAR;
            return e(
                "div",
                { className },
                e("img", {
                    src: avatar,
                    className: "chat-avatar",
                    alt: username,
                    loading: "lazy",
                    referrerPolicy: "no-referrer",
                }),
                e(
                    "div",
                    { className: "chat-message-content" },
                    e(
                        "div",
                        { className: "chat-message-header" },
                        e("span", {
                            className: "chat-username",
                            dangerouslySetInnerHTML: { __html: usernameHtml },
                        }),
                        e("span", { className: "chat-timestamp" }, formatTime(msg.created_at)),
                    ),
                    e("div", { className: "chat-message-text" }, msg.message || ""),
                ),
            );
        }

        function ChatList() {
            const messages = useChatMessages();
            useEffect(() => {
                rootEl.scrollTop = rootEl.scrollHeight;
            }, [messages.length]);

            if (!messages || messages.length === 0) {
                return e(
                    "div",
                    { className: "chat-empty" },
                    "Aucun message pour le moment",
                );
            }

            return e(
                React.Fragment,
                null,
                messages.map((m) =>
                    e(ChatMessage, { key: m.id || m.created_at || Math.random(), msg: m }),
                ),
            );
        }

        ReactDOM.createRoot(rootEl).render(e(React.StrictMode, null, e(ChatList)));
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mountReact, { once: true });
    } else {
        mountReact();
    }
})();
