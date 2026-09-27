// credits-ui.js: the lobby "Credits" button and its modal.
//
// Lists the people who made the game's outside assets (art packs, fonts,
// sounds). To add someone, add a line to CREDITS below: { what, by, link,
// note }. `link` is optional and opens in a new tab. Uses the Change Log
// modal styles (css/paper-ui-lobby.css). No game deps.
(function () {
    'use strict';

    const CREDITS = [
        {
            section: 'Game',
            items: [
                { what: 'Godaigo: game design and development', by: 'Jake Seegers' },
            ],
        },
        {
            section: 'Art',
            items: [
                { what: 'Popup Emotes Pack (pixel emotes)', by: 'Pipoya', link: 'https://pipoya.itch.io/' },
                { what: 'Paper UI System (menus and panels)', by: 'Humble Pixel', link: 'https://humblepixel.itch.io/' },
            ],
        },
        {
            section: 'Fonts',
            items: [
                { what: 'VT323', by: 'Peter Hull', link: 'https://fonts.google.com/specimen/VT323', note: 'SIL Open Font License' },
                { what: 'Press Start 2P', by: 'CodeMan38', link: 'https://fonts.google.com/specimen/Press+Start+2P', note: 'SIL Open Font License' },
                { what: 'Space Grotesk', by: 'Florian Karsten', link: 'https://fonts.google.com/specimen/Space+Grotesk', note: 'SIL Open Font License' },
                { what: 'JetBrains Mono', by: 'JetBrains', link: 'https://fonts.google.com/specimen/JetBrains+Mono', note: 'SIL Open Font License' },
            ],
        },
    ];

    function _esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function itemHtml(it) {
        const by = it.link
            ? `<a href="${_esc(it.link)}" target="_blank" rel="noopener noreferrer">${_esc(it.by)}</a>`
            : _esc(it.by);
        const note = it.note ? ` <span class="credits-note">(${_esc(it.note)})</span>` : '';
        return `<li><span class="credits-what">${_esc(it.what)}</span> by ${by}${note}</li>`;
    }

    function open() {
        document.getElementById('credits-overlay')?.remove();
        const body = CREDITS.map(sec => `
            <div class="changelog-entry">
                <div class="changelog-entry-head"><span class="changelog-entry-title">${_esc(sec.section)}</span></div>
                <ul>${sec.items.map(itemHtml).join('')}</ul>
            </div>`).join('');
        const overlay = document.createElement('div');
        overlay.id = 'credits-overlay';
        overlay.innerHTML = `
            <div class="changelog-modal" role="dialog" aria-label="Credits">
                <div class="changelog-title">Credits</div>
                <div class="changelog-body">${body}
                    <div class="credits-thanks">Thank you to everyone who made these!</div>
                </div>
                <button class="changelog-close">Close</button>
            </div>`;
        overlay.addEventListener('click', ev => { if (ev.target === overlay) overlay.remove(); });
        overlay.querySelector('.changelog-close').addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
    }

    window.Credits = { open, list: () => CREDITS };
})();
