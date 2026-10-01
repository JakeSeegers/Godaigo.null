/**
 * Scroll Definitions for Godaigo
 *
 * This file contains all scroll pattern definitions.
 * Each scroll has:
 * - name: Display name
 * - description: What the scroll does
 * - level: Power level (affects stone gains)
 * - element: The element type (earth, water, fire, wind, void, catacomb)
 * - patterns: Array of valid pattern configurations (relative hex coordinates)
 * - canCounter: (optional) Special scrolls that can counter other scrolls
 */

// Pattern templates shared across element types
const LEVEL_1_PATTERNS = [
    [{ q: 0, r: -1 }, { q: 0, r: 1 }],
    [{ q: 1, r: -1 }, { q: -1, r: 1 }],
    [{ q: 1, r: 0 }, { q: -1, r: 0 }]
];

const LEVEL_2_PATTERNS = [
    [{ q: -1, r: -1 }, { q: 1, r: 1 }],
    [{ q: 1, r: -2 }, { q: -1, r: 2 }],
    [{ q: 2, r: -1 }, { q: -2, r: 1 }]
];

const LEVEL_3_PATTERNS = [
    [{ q: 1, r: -1 }, { q: -1, r: 0 }, { q: 0, r: 1 }],
    [{ q: 0, r: -1 }, { q: 1, r: 0 }, { q: -1, r: 1 }]
];

const LEVEL_4_PATTERNS = [
    [{ q: 1, r: -2 }, { q: -2, r: 1 }, { q: 1, r: 1 }],
    [{ q: -1, r: -1 }, { q: 2, r: -1 }, { q: -1, r: 2 }]
];

const LEVEL_5_PATTERNS = [
    [{ q: 0, r: -1 }, { q: 0, r: 1 }, { q: 2, r: -1 }, { q: -2, r: 1 }],
    [{ q: 1, r: -1 }, { q: -1, r: 1 }, { q: -1, r: -1 }, { q: 1, r: 1 }],
    [{ q: 1, r: 0 }, { q: -1, r: 0 }, { q: 1, r: -2 }, { q: -1, r: 2 }]
];

// Helper to convert Roman numerals
function toRoman(num) {
    const romans = ['I', 'II', 'III', 'IV', 'V'];
    return romans[num - 1] || num.toString();
}

// Helper function to rotate hex coordinate by 60 degrees
function rotateHex(q, r, steps) {
    let nq = q, nr = r;
    for (let i = 0; i < steps; i++) {
        const tempQ = nq;
        nq = -nr;
        nr = -(-tempQ - nr);
    }
    return { q: nq, r: nr };
}

// Earth scroll effect definitions
const EARTH_SCROLL_EFFECTS = {
    1: { name: 'Iron Stance', description: 'Counter the most recently activated scroll. That scroll is cancelled.', isCounter: true, oncePerTurn: true },
    2: { name: 'Shifting Sands', description: "Select two tiles to swap their positions. Tile must be unoccupied by stones. If there is one player on that tile, move them to the center of the tile. Cannot target a tile with multiple players on it." },
    3: { name: "Mason's Savvy", description: 'Draw up to 5 earth stones. This turn, place earth stones within 5 hexes of player.' },
    4: { name: 'Heavy Stomp', description: 'Select a tile to flip. Hidden tiles are revealed (draw scroll). Revealed tiles become hidden.' },
    5: { name: 'Avalanche', description: 'This turn, place any stones anywhere on the board (not just adjacent).' }
};

// Water scroll effect definitions
const WATER_SCROLL_EFFECTS = {
    1: { name: 'Reflect', description: 'Duplicate the effect of the scroll that was last activated this turn.', isResponse: true, oncePerTurn: true },
    2: { name: 'Refreshing Thought', description: 'Draw a Catacomb scroll.' },
    3: { name: 'Inspiring Draught', description: 'Draw 2 scrolls from any decks, then put 1 back and shuffle that deck.' },
    4: { name: 'Wandering River', description: 'Select a tile. Until your next turn, that tile counts as any element type you choose.' },
    5: { name: 'Control the Current', description: 'Until end of turn, click adjacent water stones to transform them into any other element (free, no AP cost).' }
};

// Fire scroll effect definitions
const FIRE_SCROLL_EFFECTS = {
    1: { name: 'Unbidden Lamplight', description: 'Response: Send the triggering scroll to your hand after it resolves (scroll still resolves).', isResponse: true, oncePerTurn: true },
    2: { name: 'Burning Motivation', description: 'Until end of turn, gain 2 AP for each stone you place. Stacks if activated multiple times.' },
    3: { name: 'Sacrificial Pyre', description: 'Activate any scroll in your hand or active area (ignoring pattern). The scroll goes to the common area. Level I scrolls only as a response, never on your own turn.' },
    4: { name: 'Transmute', description: 'Discard any number of stones or scrolls to regain 2 AP each.' },
    5: { name: 'Arson', description: 'Destroy one elemental stone from an opponent\'s pool. Move Arson to the common area.' }
};

// Void scroll effect definitions
const VOID_SCROLL_EFFECTS = {
    1: { name: 'Psychic', description: "Counter the previous scroll, then play it during your turn - unless its caster pays 2 AP to negate Psychic. Move Psychic to the common area.", isCounter: true, oncePerTurn: true },
    2: { name: 'Telekinesis', description: 'Move a tile that has no stones on it. If one player is on the tile, they move to its center. Cannot move a tile with multiple players on it. It must be touching 1 other tile. Cannot move a tile if it would strand an adjacent tile.' },
    3: { name: 'Simplify', description: 'Scrolls cost 1 AP for you to activate until the beginning of your next turn.' },
    4: { name: "Scholar's Insight", description: 'Search through a Scroll Deck and add a scroll of your choice to your hand. Shuffle that deck afterwards.' },
    5: { name: 'Create', description: 'Choose a stone type and draw stones equal to that stone\'s rank (Earth 5, Water 4, Fire 3, Wind 2, Void 1). Cannot exceed 5 of that type.' }
};

// Wind scroll effect definitions
const WIND_SCROLL_EFFECTS = {
    1: { name: 'Sigh of Recollection', description: 'Draw a scroll and a stone of the type that was just activated, if available. Draw one stone of each if it was a Catacomb scroll.', isResponse: true, oncePerTurn: true },
    2: { name: 'Breath of Power', description: 'Until end of turn, you may move adjacent stones to another adjacent empty space.' },
    3: { name: 'Respirate', description: 'Draw 3 wind stones. At end of turn, return all your wind stones to the source pools.' },
    4: { name: 'Take Flight', description: "Select a player to teleport. If you target yourself, you choose where to land; if you target another player, they choose instead. Destination must be an unoccupied hex on a tile occupied by another player. Cannot target player tiles. Cancels if no valid destination exists." },
    5: { name: 'Freedom', description: 'Until your next turn, you may teleport for free between elemental shrine centers, the same way a catacomb tile lets you teleport (only applies to you).' }
};

// Catacomb scroll effect definitions (keyed by scroll number, e.g. 1 = CATACOMB_SCROLL_1)
const CATACOMB_SCROLL_EFFECTS = {
    1: { name: 'Mudslide', description: 'Until end of turn, earth and water stones act as wind stones for movement (free movement).' },
    2: { name: 'Mine', description: 'If the center of this pattern is an elemental shrine, that shrine produces twice as many stones this turn (cannot exceed 5).' },
    3: { name: 'Call to Adventure', description: 'You may flip one unoccupied tile. Until end of turn, when you reveal a tile, immediately draw Elemental Stones as if you had ended your turn on that tile\'s center.' },
    4: { name: 'Excavate', description: 'You, your scrolls, and stones cannot be the target of any scroll until your next turn. Your scrolls cannot be responded to this turn. At the beginning of your next turn, you may teleport to any unoccupied hex.' },
    5: { name: 'Steam Vents', description: 'Until end of turn, spending an AP to move allows you to move two spaces instead of one.' },
    6: { name: 'Seed the Skies', description: 'Gather up to 5 water stones. This turn, you may place water and wind stones on any valid hex (not just adjacent).' },
    7: { name: 'Reflecting Pool', description: 'Regain 2 AP for each different stone type within 5 spaces of you. This can be used once per turn.' },
    8: { name: 'Plunder', description: 'Choose a target player. Select one of their active scrolls and discard it to the common area.' },
    9: { name: 'Quick Reflexes', description: 'Search for an available level 1 scroll and add it to your hand. Draw 2 stones of that type. Until your next turn, level 1 scrolls cost 0 AP to activate. Shuffle the deck searched.' },
    10: { name: 'Combust', description: 'Select a tile and destroy all stones on it. Cannot target player tiles.' }
};

// Generate elemental scroll definitions
function generateElementalScrolls() {
    const scrolls = {};
    const elementTypes = ['earth', 'water', 'fire', 'wind', 'void'];
    const patternLevels = [LEVEL_1_PATTERNS, LEVEL_2_PATTERNS, LEVEL_3_PATTERNS, LEVEL_4_PATTERNS, LEVEL_5_PATTERNS];

    elementTypes.forEach(element => {
        patternLevels.forEach((patterns, level) => {
            const scrollName = `${element.toUpperCase()}_SCROLL_${level + 1}`;

            // Check for custom effect definitions
            let name, description, isCounter = false;
            const effectMaps = {
                earth: EARTH_SCROLL_EFFECTS,
                water: WATER_SCROLL_EFFECTS,
                fire: FIRE_SCROLL_EFFECTS,
                wind: WIND_SCROLL_EFFECTS,
                void: VOID_SCROLL_EFFECTS
            };

            let isResponse = false;
            let oncePerTurn = false;
            if (effectMaps[element] && effectMaps[element][level + 1]) {
                const effect = effectMaps[element][level + 1];
                name = effect.name;
                description = effect.description;
                isCounter = effect.isCounter || false;
                isResponse = effect.isResponse || false;
                oncePerTurn = effect.oncePerTurn || false;
            } else {
                name = `${element.charAt(0).toUpperCase() + element.slice(1)} Scroll ${toRoman(level + 1)}`;
                description = `Stand in the pattern and cast to activate ${element}.`;
            }

            scrolls[scrollName] = {
                name: name,
                description: description,
                level: level + 1,
                element: element,
                patterns: patterns.map(pattern =>
                    pattern.map(pos => ({ ...pos, type: element }))
                ),
                // Earth I (Iron Stance) can counter any scroll
                canCounter: isCounter ? 'any' : null,
                // Fire I (Unbidden Lamplight) is a response scroll (shows in response window but doesn't cancel)
                isResponse: isResponse,
                // Response/counter scrolls flagged oncePerTurn may only be cast once per turn
                // (one total across all players — see ResponseWindowSystem enforcement)
                oncePerTurn: oncePerTurn,
                hasEffect: !!(effectMaps[element] && effectMaps[element][level + 1]) // Flag to indicate this scroll has a special effect
            };
        });
    });

    return scrolls;
}

// Generate catacomb scroll definitions (multi-element patterns)
function generateCatacombScrolls() {
    const catacombBase = {
        CATACOMB_SCROLL_1: [
            { q: -1, r: -1, type: "water" },
            { q: 1, r: 1, type: "water" },
            { q: 1, r: -2, type: "earth" },
            { q: -1, r: 2, type: "earth" }
        ],
        CATACOMB_SCROLL_2: [
            { q: -1, r: -1, type: "earth" },
            { q: 1, r: 1, type: "earth" },
            { q: 1, r: -2, type: "fire" },
            { q: -1, r: 2, type: "fire" }
        ],
        CATACOMB_SCROLL_3: [
            { q: -1, r: -1, type: "wind" },
            { q: 1, r: 1, type: "wind" },
            { q: 1, r: -2, type: "earth" },
            { q: -1, r: 2, type: "earth" }
        ],
        CATACOMB_SCROLL_4: [
            { q: -1, r: -1, type: "void" },
            { q: 1, r: 1, type: "void" },
            { q: 1, r: -2, type: "earth" },
            { q: -1, r: 2, type: "earth" }
        ],
        CATACOMB_SCROLL_5: [
            { q: -1, r: -1, type: "water" },
            { q: 1, r: 1, type: "water" },
            { q: 1, r: -2, type: "fire" },
            { q: -1, r: 2, type: "fire" }
        ],
        CATACOMB_SCROLL_6: [
            { q: -1, r: -1, type: "wind" },
            { q: 1, r: 1, type: "wind" },
            { q: 1, r: -2, type: "water" },
            { q: -1, r: 2, type: "water" }
        ],
        CATACOMB_SCROLL_7: [
            { q: -1, r: -1, type: "void" },
            { q: 1, r: 1, type: "void" },
            { q: 1, r: -2, type: "water" },
            { q: -1, r: 2, type: "water" }
        ],
        CATACOMB_SCROLL_8: [
            { q: -1, r: -1, type: "fire" },
            { q: 1, r: 1, type: "fire" },
            { q: 1, r: -2, type: "wind" },
            { q: -1, r: 2, type: "wind" }
        ],
        CATACOMB_SCROLL_9: [
            { q: -1, r: -1, type: "void" },
            { q: 1, r: 1, type: "void" },
            { q: 1, r: -2, type: "wind" },
            { q: -1, r: 2, type: "wind" }
        ],
        CATACOMB_SCROLL_10: [
            { q: -1, r: -1, type: "fire" },
            { q: 1, r: 1, type: "fire" },
            { q: 1, r: -2, type: "void" },
            { q: -1, r: 2, type: "void" }
        ]
    };

    const scrolls = {};

    Object.entries(catacombBase).forEach(([scrollName, basePattern]) => {
        const scrollNum = parseInt(scrollName.split('_')[2]);

        // Create 3 rotational variations (0, 120, 240 degrees)
        const variations = [
            basePattern,
            basePattern.map(pos => ({
                ...rotateHex(pos.q, pos.r, 2),
                type: pos.type
            })),
            basePattern.map(pos => ({
                ...rotateHex(pos.q, pos.r, 4),
                type: pos.type
            }))
        ];

        // Check for custom catacomb effect definitions
        const catEffect = CATACOMB_SCROLL_EFFECTS[scrollNum];
        const catName = catEffect ? catEffect.name : `Catacomb Scroll ${scrollNum}`;
        const catDesc = catEffect ? catEffect.description : `Multi-element pattern: gain +2 of each stone type (2 AP)`;

        scrolls[scrollName] = {
            name: catName,
            description: catDesc,
            level: 2,
            element: 'catacomb',
            patterns: variations,
            hasEffect: !!catEffect
        };
    });

    return scrolls;
}

// Build complete scroll definitions
const SCROLL_DEFINITIONS = {
    ...generateElementalScrolls(),
    ...generateCatacombScrolls()
};

// Initial deck configurations
const SCROLL_DECKS = {
    earth: ['EARTH_SCROLL_1', 'EARTH_SCROLL_2', 'EARTH_SCROLL_3', 'EARTH_SCROLL_4', 'EARTH_SCROLL_5'],
    water: ['WATER_SCROLL_1', 'WATER_SCROLL_2', 'WATER_SCROLL_3', 'WATER_SCROLL_4', 'WATER_SCROLL_5'],
    fire: ['FIRE_SCROLL_1', 'FIRE_SCROLL_2', 'FIRE_SCROLL_3', 'FIRE_SCROLL_4', 'FIRE_SCROLL_5'],
    wind: ['WIND_SCROLL_1', 'WIND_SCROLL_2', 'WIND_SCROLL_3', 'WIND_SCROLL_4', 'WIND_SCROLL_5'],
    void: ['VOID_SCROLL_1', 'VOID_SCROLL_2', 'VOID_SCROLL_3', 'VOID_SCROLL_4', 'VOID_SCROLL_5'],
    catacomb: ['CATACOMB_SCROLL_1', 'CATACOMB_SCROLL_2', 'CATACOMB_SCROLL_3', 'CATACOMB_SCROLL_4', 'CATACOMB_SCROLL_5',
               'CATACOMB_SCROLL_6', 'CATACOMB_SCROLL_7', 'CATACOMB_SCROLL_8', 'CATACOMB_SCROLL_9', 'CATACOMB_SCROLL_10']
};

// Formal rulings for scrolls — displayed in the Scroll Reference "Rulings" tab.
// Keyed by scroll ID. Each entry is an array of ruling strings.
const SCROLL_RULINGS = {
    WATER_SCROLL_5: [
        "If an element has no stones remaining in the source pool, you cannot transform a water stone into that element.",
        "Each transformation pulls a replacement stone from the source pool - pool counts update immediately and affect all future placements this game."
    ]
};

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.SCROLL_DEFINITIONS = SCROLL_DEFINITIONS;
    window.SCROLL_DECKS = SCROLL_DECKS;
    window.SCROLL_RULINGS = SCROLL_RULINGS;
}
