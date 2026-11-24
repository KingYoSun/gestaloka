export interface paths {
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            service: "gestaloka";
                            /** @enum {string} */
                            status: "ok";
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/stories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    since?: string;
                    until?: string;
                    worldId?: string;
                    author?: string;
                    player?: string;
                    title?: string;
                    bookmarked?: "1";
                    sort?: "updated" | "newest" | "oldest" | "player" | "author" | "title";
                    before?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                worldId: string;
                                worldTitle: string;
                                title: string;
                                author: string;
                                player?: string;
                                /** Format: date-time */
                                publishedAt?: string;
                                mine: boolean;
                                bookmarked?: boolean;
                                /** Format: date-time */
                                updatedAt?: string;
                            }[];
                            /** Format: uuid */
                            next: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/stories/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    since?: string;
                    until?: string;
                    sort?: "number" | "newest" | "oldest";
                    after?: string;
                    episode?: string;
                    image?: "1";
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            story: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                worldId: string;
                                worldTitle: string;
                                title: string;
                                author: string;
                                player?: string;
                                /** Format: date-time */
                                publishedAt?: string;
                                mine: boolean;
                                bookmarked?: boolean;
                            };
                            episodes: {
                                number: number;
                                /** Format: date-time */
                                publishedAt: string;
                                title?: string;
                            }[];
                            episode: {
                                number: number;
                                /** Format: date-time */
                                publishedAt: string;
                                title?: string;
                                body: string;
                                hasImage?: boolean;
                                /** Format: byte */
                                image?: string;
                            };
                            hasNextEpisode: boolean;
                            previousEpisode?: number | null;
                            nextEpisode?: number | null;
                            next: number | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/stories/{id}/bookmark": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        bookmarked: boolean;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            bookmarked: boolean;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/stories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": ({
                        /** Format: uuid */
                        requestId: string;
                        body: string;
                        /** Format: byte */
                        image?: string;
                        episodeTitle?: string;
                        title: string;
                        author: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        body: string;
                        /** Format: byte */
                        image?: string;
                        episodeTitle?: string;
                        /** Format: uuid */
                        storyId: string;
                    }) | {
                        /** @enum {string} */
                        operation: "edit";
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storyId: string;
                        episode?: number;
                        episodeTitle?: string | null;
                        title?: string;
                        author?: string;
                        body?: string;
                        /** Format: byte */
                        image?: string | null;
                    } | {
                        /** @enum {string} */
                        operation: "delete";
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storyId: string;
                        episode?: number;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            storyId: string;
                            episode: number;
                            /** @enum {string} */
                            deleted?: "story" | "episode";
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                        }[];
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        prompt: string;
                        playerSettings?: string;
                        budgetUsd: number;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            inventoryLimits?: {
                                /** @description 人物の手持ち枠 */
                                carrySlots: number;
                                /** @description 保管庫の標準枠 */
                                storageSlots: number;
                                /** @description バンドルに収められる通常枠の合計。既定は15 */
                                bundleSlots?: number;
                                /** @description 物品の1枠あたりの標準個数 */
                                unitsPerSlot: number;
                                /** @description 人物の技能枠。既定は50。手持ち枠の有効・無効にかかわらず適用する */
                                skillSlots: number;
                            };
                            inventoryCapacity?: boolean;
                            /** Format: uuid */
                            id: string;
                            prompt: string;
                            playerSettings?: string;
                            startingItems?: {
                                /** @description 物品の呼称 */
                                label: string;
                                /** @description 個数 */
                                count: number;
                                /**
                                 * Format: uuid
                                 * @description 物品の系列ID
                                 */
                                seriesId: string;
                                /** @description 1枠あたりの個数。省くと世界の標準、unlimitedなら何個でも1枠 */
                                unitsPerSlot?: number | "unlimited";
                            }[];
                            /** Format: date-time */
                            createdAt: string;
                            /** @enum {string} */
                            state: "generating" | "ready" | "running" | "paused" | "finished" | "joining" | "playing" | "play_paused";
                            at: number;
                            target: number;
                            hasParticipant: boolean;
                            publication: {
                                title: string;
                                description: string;
                                published: boolean;
                                accepting: boolean;
                                playerList: boolean;
                                instantNpcMultiplier: number;
                                deathJudgment: boolean;
                                respawnEnabled: boolean;
                                deathCriteria: string;
                                /** Format: uuid */
                                deathPlaceId: string | null;
                                nonCombatAreas: {
                                    /** Format: uuid */
                                    rootId: string;
                                    memberPlaceIds: string[];
                                }[];
                            };
                            error: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            inventoryLimits?: {
                                /** @description 人物の手持ち枠 */
                                carrySlots: number;
                                /** @description 保管庫の標準枠 */
                                storageSlots: number;
                                /** @description バンドルに収められる通常枠の合計。既定は15 */
                                bundleSlots?: number;
                                /** @description 物品の1枠あたりの標準個数 */
                                unitsPerSlot: number;
                                /** @description 人物の技能枠。既定は50。手持ち枠の有効・無効にかかわらず適用する */
                                skillSlots: number;
                            };
                            inventoryCapacity?: boolean;
                            /** Format: uuid */
                            id: string;
                            prompt: string;
                            playerSettings?: string;
                            startingItems?: {
                                /** @description 物品の呼称 */
                                label: string;
                                /** @description 個数 */
                                count: number;
                                /**
                                 * Format: uuid
                                 * @description 物品の系列ID
                                 */
                                seriesId: string;
                                /** @description 1枠あたりの個数。省くと世界の標準、unlimitedなら何個でも1枠 */
                                unitsPerSlot?: number | "unlimited";
                            }[];
                            /** Format: date-time */
                            createdAt: string;
                            /** @enum {string} */
                            state: "generating" | "ready" | "running" | "paused" | "finished" | "joining" | "playing" | "play_paused";
                            at: number;
                            target: number;
                            hasParticipant: boolean;
                            publication: {
                                title: string;
                                description: string;
                                published: boolean;
                                accepting: boolean;
                                playerList: boolean;
                                instantNpcMultiplier: number;
                                deathJudgment: boolean;
                                respawnEnabled: boolean;
                                deathCriteria: string;
                                /** Format: uuid */
                                deathPlaceId: string | null;
                                nonCombatAreas: {
                                    /** Format: uuid */
                                    rootId: string;
                                    memberPlaceIds: string[];
                                }[];
                            };
                            error: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/commands": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "advance";
                        /** @description 管理者が追加する期間。ミリ秒表記で、1日以上かつ1日の整数倍 */
                        duration: number;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "resume" | "finish";
                    };
                };
            };
            responses: {
                /** @description Default Response */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            inventoryLimits?: {
                                /** @description 人物の手持ち枠 */
                                carrySlots: number;
                                /** @description 保管庫の標準枠 */
                                storageSlots: number;
                                /** @description バンドルに収められる通常枠の合計。既定は15 */
                                bundleSlots?: number;
                                /** @description 物品の1枠あたりの標準個数 */
                                unitsPerSlot: number;
                                /** @description 人物の技能枠。既定は50。手持ち枠の有効・無効にかかわらず適用する */
                                skillSlots: number;
                            };
                            inventoryCapacity?: boolean;
                            /** Format: uuid */
                            id: string;
                            prompt: string;
                            playerSettings?: string;
                            startingItems?: {
                                /** @description 物品の呼称 */
                                label: string;
                                /** @description 個数 */
                                count: number;
                                /**
                                 * Format: uuid
                                 * @description 物品の系列ID
                                 */
                                seriesId: string;
                                /** @description 1枠あたりの個数。省くと世界の標準、unlimitedなら何個でも1枠 */
                                unitsPerSlot?: number | "unlimited";
                            }[];
                            /** Format: date-time */
                            createdAt: string;
                            /** @enum {string} */
                            state: "generating" | "ready" | "running" | "paused" | "finished" | "joining" | "playing" | "play_paused";
                            at: number;
                            target: number;
                            hasParticipant: boolean;
                            publication: {
                                title: string;
                                description: string;
                                published: boolean;
                                accepting: boolean;
                                playerList: boolean;
                                instantNpcMultiplier: number;
                                deathJudgment: boolean;
                                respawnEnabled: boolean;
                                deathCriteria: string;
                                /** Format: uuid */
                                deathPlaceId: string | null;
                                nonCombatAreas: {
                                    /** Format: uuid */
                                    rootId: string;
                                    memberPlaceIds: string[];
                                }[];
                            };
                            error: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/records": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    before?: string;
                    after?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: string;
                                at: number;
                                summary: string;
                                continuation: string | null;
                                counts: {
                                    nodes: number;
                                    edges: number;
                                };
                            }[];
                            next: string | null;
                            previous: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/knowledge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    before?: string;
                    after?: string;
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            viewerId: string;
                            at: number;
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                kind: "observation" | "interpretation";
                                text: string;
                                characters?: {
                                    /** Format: uuid */
                                    actorId: string;
                                    name: string;
                                    icon: string | null;
                                    count?: number;
                                }[];
                                from: number;
                                until?: number;
                            }[];
                            next: string | null;
                            previous: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/belongings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            viewerId: string;
                            items: {
                                label: string;
                                quantity: number;
                                mine: boolean;
                            }[];
                            storages: {
                                /** Format: uuid */
                                id: string;
                                label: string;
                                items: {
                                    label: string;
                                    quantity: number;
                                    mine: boolean;
                                }[];
                            }[];
                            skills: {
                                /** Format: uuid */
                                id: string;
                                text: string;
                                name?: string;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/partners": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    actorId?: string;
                    before?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                actorId: string;
                                name: string;
                                /** Format: uuid */
                                placeId: string | null;
                                place: string | null;
                            }[];
                            /** Format: uuid */
                            next: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/play": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            viewerId: string;
                            /** Format: uuid */
                            runId: string | null;
                            at: number;
                            /** @enum {string} */
                            state: "ready" | "running" | "paused";
                            error: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            viewerId: string;
                            /** Format: uuid */
                            worldId: string;
                            actionText: string;
                            startedAt: number;
                            at: number;
                            /** @enum {string} */
                            state: "ready" | "running" | "paused";
                            error: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/scene": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    actorId?: string;
                    sceneId?: string;
                    view?: "compact";
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            scene: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                requestId: string;
                                /** Format: uuid */
                                viewerId: string;
                                at: number;
                                /** @enum {string} */
                                state: "preparing" | "ready" | "active" | "acting" | "reflecting" | "result" | "paused";
                                synopsis: string | null;
                                synopsisCharacters?: {
                                    /** Format: uuid */
                                    actorId: string;
                                    name: string;
                                    icon: string | null;
                                    count?: number;
                                }[];
                                result: string | null;
                                resultCharacters?: {
                                    /** Format: uuid */
                                    actorId: string;
                                    name: string;
                                    icon: string | null;
                                    count?: number;
                                }[];
                                error: string | null;
                                messages: {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    characters?: {
                                        /** Format: uuid */
                                        actorId: string;
                                        name: string;
                                        icon: string | null;
                                        count?: number;
                                    }[];
                                }[];
                                actions: {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    /** @enum {string} */
                                    state: "running" | "complete" | "boundary";
                                    characters?: {
                                        /** Format: uuid */
                                        actorId: string;
                                        name: string;
                                        icon: string | null;
                                        count?: number;
                                    }[];
                                }[];
                                recordIds: string[];
                                nextPurpose: string | null;
                                waiting?: {
                                    /** @enum {string} */
                                    kind: "participants" | "npc" | "system";
                                    actors: {
                                        /** Format: uuid */
                                        id: string;
                                        name: string;
                                    }[];
                                    reason: string;
                                    /** Format: date-time */
                                    deadline: string | null;
                                }[];
                                departed?: boolean;
                                waitingFor?: string[];
                                waitingInvitation?: boolean;
                                /** Format: uuid */
                                soloProposal?: string;
                                shared?: {
                                    owner: boolean;
                                    requestIds: string[];
                                    /** @enum {string} */
                                    phase: "selecting" | "inviting" | "settled";
                                    pending: number;
                                    /** Format: date-time */
                                    deadline: string | null;
                                    rounds?: number;
                                    /** @enum {string} */
                                    flow?: "open" | "manual" | "voting" | "rounds" | "inactive" | "closing";
                                };
                            } | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: {
                    actorId?: string;
                    sceneId?: string;
                    view?: "compact";
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "prepare";
                        purpose: string;
                        /** @enum {boolean} */
                        shared?: true;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "invite";
                        /** Format: uuid */
                        invitationId: string;
                        accept: boolean;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "act";
                        actionText: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "react";
                        /** Format: uuid */
                        opportunityId: string;
                        actionText: string | null;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "vote";
                        /** Format: uuid */
                        proposalId: string;
                        continue: boolean;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "start" | "finish" | "resume" | "leave";
                    };
                };
            };
            responses: {
                /** @description Default Response */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            scene: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                requestId: string;
                                /** Format: uuid */
                                viewerId: string;
                                at: number;
                                /** @enum {string} */
                                state: "preparing" | "ready" | "active" | "acting" | "reflecting" | "result" | "paused";
                                synopsis: string | null;
                                synopsisCharacters?: {
                                    /** Format: uuid */
                                    actorId: string;
                                    name: string;
                                    icon: string | null;
                                    count?: number;
                                }[];
                                result: string | null;
                                resultCharacters?: {
                                    /** Format: uuid */
                                    actorId: string;
                                    name: string;
                                    icon: string | null;
                                    count?: number;
                                }[];
                                error: string | null;
                                messages: {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    characters?: {
                                        /** Format: uuid */
                                        actorId: string;
                                        name: string;
                                        icon: string | null;
                                        count?: number;
                                    }[];
                                }[];
                                actions: {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    /** @enum {string} */
                                    state: "running" | "complete" | "boundary";
                                    characters?: {
                                        /** Format: uuid */
                                        actorId: string;
                                        name: string;
                                        icon: string | null;
                                        count?: number;
                                    }[];
                                }[];
                                recordIds: string[];
                                nextPurpose: string | null;
                                waiting?: {
                                    /** @enum {string} */
                                    kind: "participants" | "npc" | "system";
                                    actors: {
                                        /** Format: uuid */
                                        id: string;
                                        name: string;
                                    }[];
                                    reason: string;
                                    /** Format: date-time */
                                    deadline: string | null;
                                }[];
                                departed?: boolean;
                                waitingFor?: string[];
                                waitingInvitation?: boolean;
                                /** Format: uuid */
                                soloProposal?: string;
                                shared?: {
                                    owner: boolean;
                                    requestIds: string[];
                                    /** @enum {string} */
                                    phase: "selecting" | "inviting" | "settled";
                                    pending: number;
                                    /** Format: date-time */
                                    deadline: string | null;
                                    rounds?: number;
                                    /** @enum {string} */
                                    flow?: "open" | "manual" | "voting" | "rounds" | "inactive" | "closing";
                                };
                            } | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/scene/records": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    before?: string;
                    after?: string;
                    actorId?: string;
                    sceneId: string;
                    kind: "events" | "actions";
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            viewerId: string;
                            items: {
                                /** Format: uuid */
                                id: string;
                                at: number | null;
                                text: string;
                                /** @enum {string} */
                                kind: "message" | "action";
                                continuation: string | null;
                                characters?: {
                                    /** Format: uuid */
                                    actorId: string;
                                    name: string;
                                    icon: string | null;
                                    count?: number;
                                }[];
                            }[];
                            next: string | null;
                            previous: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    actorId?: string;
                    sceneId?: string;
                    view?: "wait" | "joins" | "screen";
                    after?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: {
                    actorId?: string;
                    expectedSp?: number;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "apply";
                        action: {
                            /** @enum {string} */
                            type: "direct";
                            text: string;
                            operations: ({
                                /** @enum {string} */
                                type: "locate";
                                /** Format: uuid */
                                subjectId: string;
                                text: string;
                                aboutIds: string[];
                                /**
                                 * Format: uuid
                                 * @description 直接滞在する具体的な場所。複数の場所を参照するときに指定する
                                 */
                                directPlaceId?: string;
                            } | {
                                /** @enum {string} */
                                type: "move";
                                /** Format: uuid */
                                item: string;
                                /**
                                 * Format: uuid
                                 * @description 今持っている存在。所在が未記録ならnull
                                 */
                                from: string | null;
                                /** Format: uuid */
                                to: string;
                                /** @description 対象にする個数。省くと全部。一部なら、その個数を別の物品として分ける */
                                count?: number;
                                /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                                basis: string;
                            } | {
                                /** @enum {string} */
                                type: "revoke";
                                /** Format: uuid */
                                person: string;
                                /** Format: uuid */
                                storage: string;
                            } | {
                                /** @enum {string} */
                                type: "remove";
                                /** Format: uuid */
                                id: string;
                                /** @description 減らす個数。省くと全部 */
                                count?: number;
                            })[];
                            /** Format: date-time */
                            deferredUntil?: string;
                            stealth?: boolean;
                            departAloneOnTimeout?: boolean;
                        } | {
                            /** @enum {string} */
                            type: "generate";
                            plans: {
                                text: string;
                                /** @description 成功時に組み込む手持ち・現在地の物品IDと必要数。個数の省略は1。繰り返し使う道具は含めない */
                                materials?: {
                                    /** Format: uuid */
                                    id: string;
                                    count?: number;
                                }[];
                                operation: {
                                    /** @enum {string} */
                                    type: "create";
                                    label: string;
                                    /** @description 個数。数えないまとまりなら省く */
                                    count?: number;
                                    /**
                                     * Format: uuid
                                     * @description 物品を持つ存在。持つ存在の物になる
                                     */
                                    holder: string;
                                    /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                                    basis: string;
                                } | {
                                    /** @enum {string} */
                                    type: "grant";
                                    /** Format: uuid */
                                    person: string;
                                    /** Format: uuid */
                                    storage: string;
                                    /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                                    basis: string;
                                } | {
                                    /** @enum {string} */
                                    type: "learn";
                                    /** Format: uuid */
                                    person: string;
                                    text: string;
                                    /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                                    basis: string;
                                    /** @description 成功時に消費する本人の習得済み技能ID。1件で発展、複数で統合できる */
                                    consumeSkillIds?: string[];
                                };
                            }[];
                            waitMinutes?: number;
                        } | {
                            /** @enum {string} */
                            type: "rename";
                            /** Format: uuid */
                            targetId: string;
                            name: string;
                        } | {
                            /** @enum {string} */
                            type: "clarify";
                            /** Format: uuid */
                            targetId: string;
                            text: string;
                            /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                            basis?: string;
                        } | {
                            /** @enum {string} */
                            type: "interpret";
                            /** Format: uuid */
                            targetId: string;
                            text: string;
                        } | {
                            /** @enum {string} */
                            type: "revise-memo";
                            /** Format: uuid */
                            targetId: string;
                            text: string;
                            /** Format: date-time */
                            deferredUntil?: string;
                        } | {
                            /** @enum {string} */
                            type: "increase-count";
                            /** Format: uuid */
                            itemId: string;
                            count: number;
                            text: string;
                            /** @description 成功時に組み込む手持ち・現在地の物品IDと必要数。個数の省略は1。繰り返し使う道具は含めない */
                            materials?: {
                                /** Format: uuid */
                                id: string;
                                count?: number;
                            }[];
                        } | {
                            /** @enum {string} */
                            type: "detach";
                            /** Format: uuid */
                            stateId: string;
                        } | {
                            /** @enum {string} */
                            type: "share-storage";
                            /** Format: uuid */
                            person: string;
                            /** Format: uuid */
                            storage: string;
                            /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                            basis: string;
                        } | {
                            /** @enum {string} */
                            type: "state";
                            /** Format: uuid */
                            targetId: string;
                            text: string;
                            description: string;
                            /** Format: uuid */
                            stateId?: string;
                            /** @description 成功時に組み込む手持ち・現在地の物品IDと必要数。個数の省略は1。繰り返し使う道具は含めない */
                            materials?: {
                                /** Format: uuid */
                                id: string;
                                count?: number;
                            }[];
                            /** Format: uuid */
                            attachedItemId?: string;
                            minutes?: number;
                            /** @enum {boolean} */
                            affectsMovement?: true;
                            commandRestrictions?: ("say" | "move" | "vehicle-travel")[];
                            /** @enum {string} */
                            feature?: "vehicle";
                        } | {
                            /** @enum {string} */
                            type: "state";
                            /** @enum {string} */
                            operation: "end";
                            /** Format: uuid */
                            targetId: string;
                            text: string;
                            endStateIds: string[];
                            description?: string;
                        } | {
                            /** @enum {string} */
                            type: "oppose";
                            text: string;
                            /** Format: uuid */
                            targetId: string;
                            description: string;
                            /** Format: uuid */
                            replacesStateId?: string;
                        } | {
                            /** @enum {string} */
                            type: "remove-place-item";
                            text: string;
                            /** Format: uuid */
                            placeId: string;
                            /** Format: uuid */
                            itemId: string;
                            /** @description 減らす個数。省くと全部 */
                            count?: number;
                        } | {
                            /** @enum {string} */
                            type: "seize";
                            text: string;
                            operation: {
                                /** @enum {string} */
                                type: "move";
                                /** Format: uuid */
                                item: string;
                                /** Format: uuid */
                                from: string;
                                /** Format: uuid */
                                to: string;
                                /** @description 対象にする個数。省くと全部。一部なら、その個数を別の物品として分ける */
                                count?: number;
                                /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                                basis: string;
                            };
                            stealth?: boolean;
                        };
                        expectedSp: number;
                        dependencies: {
                            key: string;
                            version: number;
                        }[];
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        targetId: string;
                        /** @enum {string} */
                        command: "draw-table-edit";
                        fromPublished?: boolean;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        targetId: string;
                        /** @enum {string} */
                        command: "draw-table-show";
                        /** @enum {string} */
                        view: "draft" | "published";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        targetId: string;
                        revision: number;
                        /** @enum {string} */
                        command: "draw-table-settings";
                        description: string;
                        price: {
                            /** Format: uuid */
                            storageId: string;
                            /** Format: uuid */
                            paymentSeriesId: string;
                            paymentLabel: string;
                            count: number;
                        } | null;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        targetId: string;
                        revision: number;
                        /** @enum {string} */
                        command: "draw-table-put";
                        /** Format: uuid */
                        entryId?: string;
                        weight?: number;
                        result: {
                            /** @enum {string} */
                            kind: "item";
                            label: string;
                        } | {
                            /** @enum {string} */
                            kind: "skill";
                            text: string;
                        } | {
                            /** @enum {string} */
                            kind: "message";
                            text: string;
                        } | {
                            /** @enum {string} */
                            kind: "stock";
                            /** Format: uuid */
                            storageId: string;
                            /** Format: uuid */
                            itemId: string;
                            count: number;
                        };
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        targetId: string;
                        revision: number;
                        /** @enum {string} */
                        command: "draw-table-remove";
                        /** Format: uuid */
                        entryId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        targetId: string;
                        revision: number;
                        /** @enum {string} */
                        command: "draw-table-publish";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "storage-list";
                        /** Format: uuid */
                        after?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        command: "storage-post";
                        /** Format: uuid */
                        itemId: string;
                        allocations: {
                            count: number;
                            /** Format: uuid */
                            recipientId?: string;
                        }[];
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        command: "storage-offers";
                        /** Format: uuid */
                        after?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        command: "storage-claim";
                        /** Format: uuid */
                        allocationId: string;
                        count: number;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        command: "storage-withdraw";
                        /** Format: uuid */
                        allocationId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        command: "storage-history";
                        /** Format: uuid */
                        after?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        command: "storage-relocate";
                        /** Format: uuid */
                        placeId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-templates";
                        /** Format: uuid */
                        after?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-propose";
                        plan: {
                            /** Format: uuid */
                            templateId: string;
                            /** Format: uuid */
                            placeId: string;
                            /** Format: uuid */
                            keeperId: string;
                            description: string;
                            product?: {
                                label: string;
                            };
                            building?: {
                                label: string;
                                materials?: {
                                    label: string;
                                    count: number;
                                    /** @enum {string} */
                                    usage: "consume" | "tool";
                                }[];
                            };
                            shop?: {
                                stock: {
                                    /** Format: uuid */
                                    itemId: string;
                                    count: number;
                                    /** Format: uuid */
                                    paymentSeriesId: string;
                                    paymentLabel: string;
                                    paymentCount: number;
                                    text: string;
                                    stockCount: number;
                                }[];
                            };
                        };
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-list";
                        /** Format: uuid */
                        after?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-show";
                        /** Format: uuid */
                        questId: string;
                        /** @description 呼称で指定された建材・道具について、提供可能数を照会する */
                        provision?: {
                            requirement: number;
                            /** Format: uuid */
                            itemId: string;
                        };
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-consent";
                        /** Format: uuid */
                        questId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-start";
                        /** Format: uuid */
                        questId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-provide";
                        /** Format: uuid */
                        questId: string;
                        /** @enum {string} */
                        phase: "build" | "open" | "craft";
                        requirement: number;
                        /** Format: uuid */
                        itemId: string;
                        count: number;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-withdraw";
                        /** Format: uuid */
                        questId: string;
                        /** Format: uuid */
                        contributionId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-cancel";
                        /** Format: uuid */
                        questId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "home-set";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "vehicle-request-control";
                        /** Format: uuid */
                        vehicleId: string;
                        oppose?: boolean;
                        /** Format: uuid */
                        applicationId?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "vehicle-board";
                        /** Format: uuid */
                        vehicleId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "vehicle-leave";
                        /** Format: uuid */
                        vehicleId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "vehicle-travel";
                        /** Format: uuid */
                        vehicleId: string;
                        /** Format: uuid */
                        destinationId: string;
                    } | {
                        text: string;
                        effect?: {
                            /**
                             * Format: uuid
                             * @description その場の存在、または同席している出現個体のID
                             */
                            targetId: string;
                            /** @description 後から対象を調べて観察できる状態 */
                            state: string;
                            /**
                             * Format: uuid
                             * @description 同じ性質について置き換える既存状態のID
                             */
                            replacesStateId?: string;
                        };
                        departs?: boolean;
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "npc-action";
                        /** Format: uuid */
                        npcId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "start";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "draw-configure";
                        /** Format: uuid */
                        targetId: string;
                        /** @description この抽選器から繰り返し得られる結果の範囲 */
                        description: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "draw";
                        /** Format: uuid */
                        targetId: string;
                        /** Format: uuid */
                        versionId?: string;
                        /** Format: uuid */
                        paymentItemId?: string;
                        /** @description 同席者に伝える行動の描写 */
                        text?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "search";
                        query: ({
                            /** @enum {string} */
                            kind: "surroundings";
                            /** Format: uuid */
                            vehicleAfter?: string;
                            /** Format: uuid */
                            passengerAfter?: string;
                        } | {
                            /** @enum {string} */
                            kind: "seek";
                        } | {
                            /** @enum {string} */
                            kind: "self";
                        } | {
                            /** @enum {string} */
                            kind: "memos";
                        } | {
                            /** @enum {string} */
                            kind: "history";
                            /** Format: uuid */
                            targetId?: string;
                        } | {
                            /** @enum {string} */
                            kind: "subject";
                            /** Format: uuid */
                            targetId: string;
                        }) | {
                            /** @enum {string} */
                            kind: "belongings";
                        };
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "contact";
                        /** Format: uuid */
                        targetId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "team-invite";
                        /** Format: uuid */
                        targetId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "team-join";
                        /** Format: uuid */
                        teamId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "team-status" | "team-leave";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "companion-request";
                        /** Format: uuid */
                        targetId: string;
                        text: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "companion-follow" | "companion-wait" | "companion-return" | "companion-dismiss";
                        /** Format: uuid */
                        targetId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "companion-move" | "companion-home";
                        /** Format: uuid */
                        targetId: string;
                        /** Format: uuid */
                        placeId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "companion-status";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "say";
                        text: string;
                        /** @enum {string} */
                        mode?: "voice" | "nonverbal";
                        /** @default [] */
                        instantNpcs?: string[];
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "memo";
                        text: string;
                        /** @default [] */
                        participants?: string[];
                        /** Format: date-time */
                        deferredUntil?: string;
                        dependencies: {
                            key: string;
                            version: number;
                        }[];
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "promote-npc";
                        /** Format: uuid */
                        sourceRequestId: string;
                        npcIndex: number;
                        description: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "explore";
                        /** @description 新しい場所の様子と、接続元からの行き方 */
                        text: string;
                        /** @description 新しい場所の呼び名 */
                        label: string;
                        /**
                         * Format: uuid
                         * @description 接続元の場所。本人の現在の所在地にある場所
                         */
                        fromId: string;
                        dependencies: {
                            key: string;
                            version: number;
                        }[];
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "receive";
                        /** Format: uuid */
                        applicationId: string;
                        accept: boolean;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "comment";
                        text: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "applications";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "withdraw";
                        /** Format: uuid */
                        applicationId: string;
                    } | {
                        /** Format: uuid */
                        storageId: string;
                        /** Format: uuid */
                        itemId: string;
                        count: number;
                        /** Format: uuid */
                        paymentSeriesId: string;
                        paymentLabel: string;
                        paymentCount: number;
                        text: string;
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "offer";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "exchange";
                        /** Format: uuid */
                        offerId: string;
                        /** Format: uuid */
                        paymentItemId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "end-turn" | "leave" | "finish";
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                            blockingStates?: {
                                /** Format: uuid */
                                stateId: string;
                                shortId: string;
                                text: string;
                                until?: number;
                            }[];
                            capacity?: {
                                /** Format: uuid */
                                holderId: string;
                                usedSlots: number;
                                limitSlots: number;
                                projectedSlots: number;
                            };
                            item?: {
                                /** Format: uuid */
                                itemId: string;
                                requestedCount: number;
                                maxAcceptableCount: number;
                            };
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/session/quote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: {
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "apply";
                        action: {
                            /** @enum {string} */
                            type: "direct";
                            text: string;
                            operations: ({
                                /** @enum {string} */
                                type: "locate";
                                /** Format: uuid */
                                subjectId: string;
                                text: string;
                                aboutIds: string[];
                                /**
                                 * Format: uuid
                                 * @description 直接滞在する具体的な場所。複数の場所を参照するときに指定する
                                 */
                                directPlaceId?: string;
                            } | {
                                /** @enum {string} */
                                type: "move";
                                /** Format: uuid */
                                item: string;
                                /**
                                 * Format: uuid
                                 * @description 今持っている存在。所在が未記録ならnull
                                 */
                                from: string | null;
                                /** Format: uuid */
                                to: string;
                                /** @description 対象にする個数。省くと全部。一部なら、その個数を別の物品として分ける */
                                count?: number;
                                /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                                basis: string;
                            } | {
                                /** @enum {string} */
                                type: "revoke";
                                /** Format: uuid */
                                person: string;
                                /** Format: uuid */
                                storage: string;
                            } | {
                                /** @enum {string} */
                                type: "remove";
                                /** Format: uuid */
                                id: string;
                                /** @description 減らす個数。省くと全部 */
                                count?: number;
                            })[];
                            /** Format: date-time */
                            deferredUntil?: string;
                            stealth?: boolean;
                            departAloneOnTimeout?: boolean;
                        } | {
                            /** @enum {string} */
                            type: "generate";
                            plans: {
                                text: string;
                                /** @description 成功時に組み込む手持ち・現在地の物品IDと必要数。個数の省略は1。繰り返し使う道具は含めない */
                                materials?: {
                                    /** Format: uuid */
                                    id: string;
                                    count?: number;
                                }[];
                                operation: {
                                    /** @enum {string} */
                                    type: "create";
                                    label: string;
                                    /** @description 個数。数えないまとまりなら省く */
                                    count?: number;
                                    /**
                                     * Format: uuid
                                     * @description 物品を持つ存在。持つ存在の物になる
                                     */
                                    holder: string;
                                    /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                                    basis: string;
                                } | {
                                    /** @enum {string} */
                                    type: "grant";
                                    /** Format: uuid */
                                    person: string;
                                    /** Format: uuid */
                                    storage: string;
                                    /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                                    basis: string;
                                } | {
                                    /** @enum {string} */
                                    type: "learn";
                                    /** Format: uuid */
                                    person: string;
                                    text: string;
                                    /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                                    basis: string;
                                    /** @description 成功時に消費する本人の習得済み技能ID。1件で発展、複数で統合できる */
                                    consumeSkillIds?: string[];
                                };
                            }[];
                            waitMinutes?: number;
                        } | {
                            /** @enum {string} */
                            type: "rename";
                            /** Format: uuid */
                            targetId: string;
                            name: string;
                        } | {
                            /** @enum {string} */
                            type: "clarify";
                            /** Format: uuid */
                            targetId: string;
                            text: string;
                            /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                            basis?: string;
                        } | {
                            /** @enum {string} */
                            type: "interpret";
                            /** Format: uuid */
                            targetId: string;
                            text: string;
                        } | {
                            /** @enum {string} */
                            type: "revise-memo";
                            /** Format: uuid */
                            targetId: string;
                            text: string;
                            /** Format: date-time */
                            deferredUntil?: string;
                        } | {
                            /** @enum {string} */
                            type: "increase-count";
                            /** Format: uuid */
                            itemId: string;
                            count: number;
                            text: string;
                            /** @description 成功時に組み込む手持ち・現在地の物品IDと必要数。個数の省略は1。繰り返し使う道具は含めない */
                            materials?: {
                                /** Format: uuid */
                                id: string;
                                count?: number;
                            }[];
                        } | {
                            /** @enum {string} */
                            type: "detach";
                            /** Format: uuid */
                            stateId: string;
                        } | {
                            /** @enum {string} */
                            type: "share-storage";
                            /** Format: uuid */
                            person: string;
                            /** Format: uuid */
                            storage: string;
                            /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                            basis: string;
                        } | {
                            /** @enum {string} */
                            type: "state";
                            /** Format: uuid */
                            targetId: string;
                            text: string;
                            description: string;
                            /** Format: uuid */
                            stateId?: string;
                            /** @description 成功時に組み込む手持ち・現在地の物品IDと必要数。個数の省略は1。繰り返し使う道具は含めない */
                            materials?: {
                                /** Format: uuid */
                                id: string;
                                count?: number;
                            }[];
                            /** Format: uuid */
                            attachedItemId?: string;
                            minutes?: number;
                            /** @enum {boolean} */
                            affectsMovement?: true;
                            commandRestrictions?: ("say" | "move" | "vehicle-travel")[];
                            /** @enum {string} */
                            feature?: "vehicle";
                        } | {
                            /** @enum {string} */
                            type: "state";
                            /** @enum {string} */
                            operation: "end";
                            /** Format: uuid */
                            targetId: string;
                            text: string;
                            endStateIds: string[];
                            description?: string;
                        } | {
                            /** @enum {string} */
                            type: "oppose";
                            text: string;
                            /** Format: uuid */
                            targetId: string;
                            description: string;
                            /** Format: uuid */
                            replacesStateId?: string;
                        } | {
                            /** @enum {string} */
                            type: "remove-place-item";
                            text: string;
                            /** Format: uuid */
                            placeId: string;
                            /** Format: uuid */
                            itemId: string;
                            /** @description 減らす個数。省くと全部 */
                            count?: number;
                        } | {
                            /** @enum {string} */
                            type: "seize";
                            text: string;
                            operation: {
                                /** @enum {string} */
                                type: "move";
                                /** Format: uuid */
                                item: string;
                                /** Format: uuid */
                                from: string;
                                /** Format: uuid */
                                to: string;
                                /** @description 対象にする個数。省くと全部。一部なら、その個数を別の物品として分ける */
                                count?: number;
                                /** @description この事実が成立した根拠。初期設定、または成立した出来事の内容 */
                                basis: string;
                            };
                            stealth?: boolean;
                        };
                        expectedSp: number;
                        dependencies: {
                            key: string;
                            version: number;
                        }[];
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        targetId: string;
                        /** @enum {string} */
                        command: "draw-table-edit";
                        fromPublished?: boolean;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        targetId: string;
                        /** @enum {string} */
                        command: "draw-table-show";
                        /** @enum {string} */
                        view: "draft" | "published";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        targetId: string;
                        revision: number;
                        /** @enum {string} */
                        command: "draw-table-settings";
                        description: string;
                        price: {
                            /** Format: uuid */
                            storageId: string;
                            /** Format: uuid */
                            paymentSeriesId: string;
                            paymentLabel: string;
                            count: number;
                        } | null;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        targetId: string;
                        revision: number;
                        /** @enum {string} */
                        command: "draw-table-put";
                        /** Format: uuid */
                        entryId?: string;
                        weight?: number;
                        result: {
                            /** @enum {string} */
                            kind: "item";
                            label: string;
                        } | {
                            /** @enum {string} */
                            kind: "skill";
                            text: string;
                        } | {
                            /** @enum {string} */
                            kind: "message";
                            text: string;
                        } | {
                            /** @enum {string} */
                            kind: "stock";
                            /** Format: uuid */
                            storageId: string;
                            /** Format: uuid */
                            itemId: string;
                            count: number;
                        };
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        targetId: string;
                        revision: number;
                        /** @enum {string} */
                        command: "draw-table-remove";
                        /** Format: uuid */
                        entryId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        targetId: string;
                        revision: number;
                        /** @enum {string} */
                        command: "draw-table-publish";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "storage-list";
                        /** Format: uuid */
                        after?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        command: "storage-post";
                        /** Format: uuid */
                        itemId: string;
                        allocations: {
                            count: number;
                            /** Format: uuid */
                            recipientId?: string;
                        }[];
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        command: "storage-offers";
                        /** Format: uuid */
                        after?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        command: "storage-claim";
                        /** Format: uuid */
                        allocationId: string;
                        count: number;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        command: "storage-withdraw";
                        /** Format: uuid */
                        allocationId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        command: "storage-history";
                        /** Format: uuid */
                        after?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        command: "storage-relocate";
                        /** Format: uuid */
                        placeId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-templates";
                        /** Format: uuid */
                        after?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-propose";
                        plan: {
                            /** Format: uuid */
                            templateId: string;
                            /** Format: uuid */
                            placeId: string;
                            /** Format: uuid */
                            keeperId: string;
                            description: string;
                            product?: {
                                label: string;
                            };
                            building?: {
                                label: string;
                                materials?: {
                                    label: string;
                                    count: number;
                                    /** @enum {string} */
                                    usage: "consume" | "tool";
                                }[];
                            };
                            shop?: {
                                stock: {
                                    /** Format: uuid */
                                    itemId: string;
                                    count: number;
                                    /** Format: uuid */
                                    paymentSeriesId: string;
                                    paymentLabel: string;
                                    paymentCount: number;
                                    text: string;
                                    stockCount: number;
                                }[];
                            };
                        };
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-list";
                        /** Format: uuid */
                        after?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-show";
                        /** Format: uuid */
                        questId: string;
                        /** @description 呼称で指定された建材・道具について、提供可能数を照会する */
                        provision?: {
                            requirement: number;
                            /** Format: uuid */
                            itemId: string;
                        };
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-consent";
                        /** Format: uuid */
                        questId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-start";
                        /** Format: uuid */
                        questId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-provide";
                        /** Format: uuid */
                        questId: string;
                        /** @enum {string} */
                        phase: "build" | "open" | "craft";
                        requirement: number;
                        /** Format: uuid */
                        itemId: string;
                        count: number;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-withdraw";
                        /** Format: uuid */
                        questId: string;
                        /** Format: uuid */
                        contributionId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "blueprint-cancel";
                        /** Format: uuid */
                        questId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "home-set";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "vehicle-request-control";
                        /** Format: uuid */
                        vehicleId: string;
                        oppose?: boolean;
                        /** Format: uuid */
                        applicationId?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "vehicle-board";
                        /** Format: uuid */
                        vehicleId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "vehicle-leave";
                        /** Format: uuid */
                        vehicleId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "vehicle-travel";
                        /** Format: uuid */
                        vehicleId: string;
                        /** Format: uuid */
                        destinationId: string;
                    } | {
                        text: string;
                        effect?: {
                            /**
                             * Format: uuid
                             * @description その場の存在、または同席している出現個体のID
                             */
                            targetId: string;
                            /** @description 後から対象を調べて観察できる状態 */
                            state: string;
                            /**
                             * Format: uuid
                             * @description 同じ性質について置き換える既存状態のID
                             */
                            replacesStateId?: string;
                        };
                        departs?: boolean;
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "npc-action";
                        /** Format: uuid */
                        npcId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "start";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "draw-configure";
                        /** Format: uuid */
                        targetId: string;
                        /** @description この抽選器から繰り返し得られる結果の範囲 */
                        description: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "draw";
                        /** Format: uuid */
                        targetId: string;
                        /** Format: uuid */
                        versionId?: string;
                        /** Format: uuid */
                        paymentItemId?: string;
                        /** @description 同席者に伝える行動の描写 */
                        text?: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "search";
                        query: ({
                            /** @enum {string} */
                            kind: "surroundings";
                            /** Format: uuid */
                            vehicleAfter?: string;
                            /** Format: uuid */
                            passengerAfter?: string;
                        } | {
                            /** @enum {string} */
                            kind: "seek";
                        } | {
                            /** @enum {string} */
                            kind: "self";
                        } | {
                            /** @enum {string} */
                            kind: "memos";
                        } | {
                            /** @enum {string} */
                            kind: "history";
                            /** Format: uuid */
                            targetId?: string;
                        } | {
                            /** @enum {string} */
                            kind: "subject";
                            /** Format: uuid */
                            targetId: string;
                        }) | {
                            /** @enum {string} */
                            kind: "belongings";
                        };
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "contact";
                        /** Format: uuid */
                        targetId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "team-invite";
                        /** Format: uuid */
                        targetId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "team-join";
                        /** Format: uuid */
                        teamId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "team-status" | "team-leave";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "companion-request";
                        /** Format: uuid */
                        targetId: string;
                        text: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "companion-follow" | "companion-wait" | "companion-return" | "companion-dismiss";
                        /** Format: uuid */
                        targetId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "companion-move" | "companion-home";
                        /** Format: uuid */
                        targetId: string;
                        /** Format: uuid */
                        placeId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "companion-status";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "say";
                        text: string;
                        /** @enum {string} */
                        mode?: "voice" | "nonverbal";
                        /** @default [] */
                        instantNpcs?: string[];
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "memo";
                        text: string;
                        /** @default [] */
                        participants?: string[];
                        /** Format: date-time */
                        deferredUntil?: string;
                        dependencies: {
                            key: string;
                            version: number;
                        }[];
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "promote-npc";
                        /** Format: uuid */
                        sourceRequestId: string;
                        npcIndex: number;
                        description: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "explore";
                        /** @description 新しい場所の様子と、接続元からの行き方 */
                        text: string;
                        /** @description 新しい場所の呼び名 */
                        label: string;
                        /**
                         * Format: uuid
                         * @description 接続元の場所。本人の現在の所在地にある場所
                         */
                        fromId: string;
                        dependencies: {
                            key: string;
                            version: number;
                        }[];
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "receive";
                        /** Format: uuid */
                        applicationId: string;
                        accept: boolean;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "comment";
                        text: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "applications";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "withdraw";
                        /** Format: uuid */
                        applicationId: string;
                    } | {
                        /** Format: uuid */
                        storageId: string;
                        /** Format: uuid */
                        itemId: string;
                        count: number;
                        /** Format: uuid */
                        paymentSeriesId: string;
                        paymentLabel: string;
                        paymentCount: number;
                        text: string;
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "offer";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "exchange";
                        /** Format: uuid */
                        offerId: string;
                        /** Format: uuid */
                        paymentItemId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "end-turn" | "leave" | "finish";
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description この申請で消費するSPの上限 */
                            expectedSp: number;
                            /** @enum {string} */
                            chargeWhen: "never" | "new-roll" | "review-saved" | "draw-saved";
                            /**
                             * Format: uuid
                             * @description 抽選器の公開版
                             */
                            versionId?: string;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/waiting": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            state: "inactive" | "paused" | "standby" | "turn" | "receiving";
                            active: boolean;
                            connected: boolean;
                            /** Format: uuid */
                            viewerId: string;
                            actionable: boolean;
                            wakeKey: string | null;
                            /** @description 最新の未読の通知のID。未読がなければnull */
                            noticeKey?: string | null;
                            /** Format: date-time */
                            expiresAt?: string;
                            /** Format: uuid */
                            sessionId?: string;
                            turn?: number;
                            /** Format: uuid */
                            applicationId?: string;
                            /** Format: date-time */
                            deadline?: string;
                            code?: string;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: {
                    actorId?: string;
                    context?: "1";
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        active: boolean;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            state: "inactive" | "paused" | "standby" | "turn" | "receiving";
                            active: boolean;
                            connected: boolean;
                            /** Format: uuid */
                            viewerId: string;
                            actionable: boolean;
                            wakeKey: string | null;
                            /** @description 最新の未読の通知のID。未読がなければnull */
                            noticeKey?: string | null;
                            /** Format: date-time */
                            expiresAt?: string;
                            /** Format: uuid */
                            sessionId?: string;
                            turn?: number;
                            /** Format: uuid */
                            applicationId?: string;
                            /** Format: date-time */
                            deadline?: string;
                            code?: string;
                            context?: {
                                /** Format: uuid */
                                actorId: string | null;
                                name?: string;
                                /** @enum {string} */
                                phase: "turn" | "receiving" | "waiting-for-return" | "parked";
                                recent: {
                                    id: string;
                                    transition: {
                                        /** @enum {string} */
                                        type: "turn-ended" | "turn-skipped" | "session-left" | "session-joined";
                                        /** Format: uuid */
                                        actorId: string;
                                        name: string;
                                        turn: number;
                                        /** Format: date-time */
                                        at: string;
                                        /** @enum {string} */
                                        reason?: "leave" | "finish";
                                        /** @enum {string} */
                                        cause?: "contact";
                                        publicActivity?: boolean;
                                        message: string;
                                    };
                                }[];
                                observations?: string[];
                                stealth?: {
                                    /** Format: uuid */
                                    placeId: string;
                                    place: string;
                                };
                                receiving?: {
                                    /** Format: uuid */
                                    applicationId: string;
                                    /** Format: uuid */
                                    senderId: string;
                                    senderName?: string;
                                    /** Format: date-time */
                                    deadline: string;
                                    text: string;
                                    changes: {
                                        nodes: ({
                                            /** Format: uuid */
                                            id: string;
                                            /** @description 同一性を参照するための呼称・識別用ラベル。職業・所属・居場所・性質・状態の事実はscriptとstatusで表す */
                                            text: string;
                                            /** @enum {string} */
                                            kind: "existence";
                                            /** @description 物品の個数。無い物品は、個数を数えないひとまとまり */
                                            count?: number;
                                            /**
                                             * Format: uuid
                                             * @description 管理者が指定する物品の系列ID
                                             */
                                            seriesId?: string;
                                            unitsPerSlot?: number | "unlimited";
                                            storageLimitSlots?: number;
                                            /** @description 本人以外で読める参加者。allはその場の全員、配列は指定した人物だけで、空なら本人だけ。省くと、手にしている物と状態は全員、技能と保管先の中身は本人だけ */
                                            viewers?: "all" | string[];
                                        } | {
                                            /** Format: uuid */
                                            id: string;
                                            text: string;
                                            /** @enum {string} */
                                            kind: "script";
                                            name?: string;
                                            derivedFromSkills?: string[];
                                            /** @enum {string} */
                                            type?: "memo" | "draw-source";
                                            drawTable?: {
                                                /** Format: uuid */
                                                versionId: string;
                                                /** Format: uuid */
                                                managerId: string;
                                                entries: {
                                                    /** Format: uuid */
                                                    entryId: string;
                                                    weight: number;
                                                    result: {
                                                        /** @enum {string} */
                                                        kind: "item";
                                                        label: string;
                                                    } | {
                                                        /** @enum {string} */
                                                        kind: "skill";
                                                        text: string;
                                                    } | {
                                                        /** @enum {string} */
                                                        kind: "message";
                                                        text: string;
                                                    } | {
                                                        /** @enum {string} */
                                                        kind: "stock";
                                                        /** Format: uuid */
                                                        storageId: string;
                                                        /** Format: uuid */
                                                        itemId: string;
                                                        count: number;
                                                    };
                                                }[];
                                                price: {
                                                    /** Format: uuid */
                                                    storageId: string;
                                                    /** Format: uuid */
                                                    paymentSeriesId: string;
                                                    paymentLabel: string;
                                                    count: number;
                                                } | null;
                                            };
                                            spawn?: {
                                                /** @enum {string} */
                                                kind: "instant-npc" | "existence" | "script" | "event";
                                                species: string;
                                                description: string;
                                                probability: number;
                                                /** @description 出現個体が品物と引き換えに受け取る代価の系列・呼称・個数。spawn-tradeで個体の発生用ノードへ結んだ品物に指定する */
                                                price?: {
                                                    /** Format: uuid */
                                                    seriesId: string;
                                                    label: string;
                                                    count: number;
                                                };
                                                minCount: number;
                                                maxCount: number;
                                            } | {
                                                /** @enum {string} */
                                                kind: "instant-npc" | "existence" | "script" | "event";
                                                species: string;
                                                description: string;
                                                probability: number;
                                                /** @description 出現個体が品物と引き換えに受け取る代価の系列・呼称・個数。spawn-tradeで個体の発生用ノードへ結んだ品物に指定する */
                                                price?: {
                                                    /** Format: uuid */
                                                    seriesId: string;
                                                    label: string;
                                                    count: number;
                                                };
                                                count: number;
                                            };
                                            /** @description 本人以外で読める参加者。allはその場の全員、配列は指定した人物だけで、空なら本人だけ。省くと、手にしている物と状態は全員、技能と保管先の中身は本人だけ */
                                            viewers?: "all" | string[];
                                        } | {
                                            /** Format: uuid */
                                            id: string;
                                            text: string;
                                            /** @enum {string} */
                                            kind: "event";
                                            appearances?: {
                                                /** @enum {string} */
                                                kind: "instant-npc" | "existence" | "script" | "event";
                                                species: string;
                                                description: string;
                                                /** Format: uuid */
                                                id: string;
                                                /** @description 出現した一団の個体数、または一つにまとまった物品の個数 */
                                                count?: number;
                                                /**
                                                 * Format: uuid
                                                 * @description 出現させた発生用ノード。個体が死亡したときのドロップの抽選に使う
                                                 */
                                                ruleId?: string;
                                            }[];
                                            instantActor?: {
                                                /** Format: uuid */
                                                id: string;
                                                /** Format: uuid */
                                                sourceEventId: string;
                                            };
                                            instantTarget?: {
                                                /** Format: uuid */
                                                id: string;
                                                /** Format: uuid */
                                                sourceEventId: string;
                                            };
                                            instantReduction?: {
                                                /** Format: uuid */
                                                targetId: string;
                                                /** @enum {string} */
                                                kind: "death" | "separation";
                                                count: number;
                                                remaining: number;
                                                /** Format: uuid */
                                                separatedId?: string;
                                            };
                                            period: {
                                                from: number;
                                                until?: number;
                                            };
                                        })[];
                                        /** @default [] */
                                        revisions: ({
                                            /** Format: uuid */
                                            id: string;
                                            /** @description 同一性を参照するための呼称・識別用ラベル。職業・所属・居場所・性質・状態の事実はscriptとstatusで表す */
                                            text: string;
                                            /** @enum {string} */
                                            kind: "existence";
                                            /** @description 物品の個数。無い物品は、個数を数えないひとまとまり */
                                            count?: number;
                                            /**
                                             * Format: uuid
                                             * @description 管理者が指定する物品の系列ID
                                             */
                                            seriesId?: string;
                                            unitsPerSlot?: number | "unlimited";
                                            storageLimitSlots?: number;
                                            /** @description 本人以外で読める参加者。allはその場の全員、配列は指定した人物だけで、空なら本人だけ。省くと、手にしている物と状態は全員、技能と保管先の中身は本人だけ */
                                            viewers?: "all" | string[];
                                        } | {
                                            /** Format: uuid */
                                            id: string;
                                            text: string;
                                            /** @enum {string} */
                                            kind: "script";
                                            name?: string;
                                            derivedFromSkills?: string[];
                                            /** @enum {string} */
                                            type?: "memo" | "draw-source";
                                            drawTable?: {
                                                /** Format: uuid */
                                                versionId: string;
                                                /** Format: uuid */
                                                managerId: string;
                                                entries: {
                                                    /** Format: uuid */
                                                    entryId: string;
                                                    weight: number;
                                                    result: {
                                                        /** @enum {string} */
                                                        kind: "item";
                                                        label: string;
                                                    } | {
                                                        /** @enum {string} */
                                                        kind: "skill";
                                                        text: string;
                                                    } | {
                                                        /** @enum {string} */
                                                        kind: "message";
                                                        text: string;
                                                    } | {
                                                        /** @enum {string} */
                                                        kind: "stock";
                                                        /** Format: uuid */
                                                        storageId: string;
                                                        /** Format: uuid */
                                                        itemId: string;
                                                        count: number;
                                                    };
                                                }[];
                                                price: {
                                                    /** Format: uuid */
                                                    storageId: string;
                                                    /** Format: uuid */
                                                    paymentSeriesId: string;
                                                    paymentLabel: string;
                                                    count: number;
                                                } | null;
                                            };
                                            spawn?: {
                                                /** @enum {string} */
                                                kind: "instant-npc" | "existence" | "script" | "event";
                                                species: string;
                                                description: string;
                                                probability: number;
                                                /** @description 出現個体が品物と引き換えに受け取る代価の系列・呼称・個数。spawn-tradeで個体の発生用ノードへ結んだ品物に指定する */
                                                price?: {
                                                    /** Format: uuid */
                                                    seriesId: string;
                                                    label: string;
                                                    count: number;
                                                };
                                                minCount: number;
                                                maxCount: number;
                                            } | {
                                                /** @enum {string} */
                                                kind: "instant-npc" | "existence" | "script" | "event";
                                                species: string;
                                                description: string;
                                                probability: number;
                                                /** @description 出現個体が品物と引き換えに受け取る代価の系列・呼称・個数。spawn-tradeで個体の発生用ノードへ結んだ品物に指定する */
                                                price?: {
                                                    /** Format: uuid */
                                                    seriesId: string;
                                                    label: string;
                                                    count: number;
                                                };
                                                count: number;
                                            };
                                            /** @description 本人以外で読める参加者。allはその場の全員、配列は指定した人物だけで、空なら本人だけ。省くと、手にしている物と状態は全員、技能と保管先の中身は本人だけ */
                                            viewers?: "all" | string[];
                                        } | {
                                            /** Format: uuid */
                                            id: string;
                                            text: string;
                                            /** @enum {string} */
                                            kind: "event";
                                            appearances?: {
                                                /** @enum {string} */
                                                kind: "instant-npc" | "existence" | "script" | "event";
                                                species: string;
                                                description: string;
                                                /** Format: uuid */
                                                id: string;
                                                /** @description 出現した一団の個体数、または一つにまとまった物品の個数 */
                                                count?: number;
                                                /**
                                                 * Format: uuid
                                                 * @description 出現させた発生用ノード。個体が死亡したときのドロップの抽選に使う
                                                 */
                                                ruleId?: string;
                                            }[];
                                            instantActor?: {
                                                /** Format: uuid */
                                                id: string;
                                                /** Format: uuid */
                                                sourceEventId: string;
                                            };
                                            instantTarget?: {
                                                /** Format: uuid */
                                                id: string;
                                                /** Format: uuid */
                                                sourceEventId: string;
                                            };
                                            instantReduction?: {
                                                /** Format: uuid */
                                                targetId: string;
                                                /** @enum {string} */
                                                kind: "death" | "separation";
                                                count: number;
                                                remaining: number;
                                                /** Format: uuid */
                                                separatedId?: string;
                                            };
                                            period: {
                                                from: number;
                                                until?: number;
                                            };
                                        })[];
                                        edges: {
                                            /** Format: uuid */
                                            id: string;
                                            /** @enum {string} */
                                            kind: "has" | "effect" | "happen" | "see" | "interpret" | "status";
                                            /** Format: uuid */
                                            source: string;
                                            /** Format: uuid */
                                            target: string;
                                            /**
                                             * @description status/interpretはcontentかabout。hasの役割なしは、存在へ向くと物品を持つこと、記述へ向くと記録やメモを持つこと。useは家・場所の保管先の登録。use・skill・summaryと物品を持つhasは実行側だけが記録する
                                             * @enum {string}
                                             */
                                            role?: "content" | "about" | "use" | "skill" | "summary";
                                            /** @description 関係の内容。seeでは受容本文。status/contentでtext=locationは主体の現在の所在専用のscriptを示し、status/aboutで場所を参照する */
                                            text?: string;
                                            period: {
                                                from: number;
                                                until?: number;
                                            };
                                            observation?: {
                                                /** @description 受容した側面・範囲。textがない場合は、受容内容の本文も含める */
                                                aspect: string;
                                                through: number;
                                                /** @default [] */
                                                sourceIds: string[];
                                                /** @default [] */
                                                pathIds: string[];
                                                /** @description サーバーが確定時に保存する版。モデルからの値は使用しない */
                                                versions?: {
                                                    [key: string]: number;
                                                };
                                            };
                                            commandRestrictions?: ("say" | "move" | "vehicle-travel")[];
                                            stateOrigin?: {
                                                /** Format: uuid */
                                                requestId: string;
                                                /** Format: uuid */
                                                actorId: string;
                                                /** Format: uuid */
                                                attachedItemId?: string;
                                                /** @enum {boolean} */
                                                affectsMovement?: true;
                                            };
                                        }[];
                                        endEdges: string[];
                                    };
                                };
                                receiptRequest?: {
                                    /** Format: uuid */
                                    applicationId: string;
                                    /** Format: uuid */
                                    senderId: string;
                                    senderName?: string;
                                    /** Format: date-time */
                                    deadline: string;
                                    memoTexts: string[];
                                };
                                receiptResult?: {
                                    /** Format: uuid */
                                    applicationId: string;
                                    /** @enum {string} */
                                    outcome: "accepted" | "rejected" | "expired" | "cancelled";
                                    turn: number;
                                    /** Format: date-time */
                                    at: string;
                                    message: string;
                                    code?: string;
                                    rejectedBy?: {
                                        /** Format: uuid */
                                        actorId: string;
                                        name: string;
                                    };
                                    unanswered?: string[];
                                };
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            date: string;
                            version: number;
                            dailyLimit: number;
                            turnsPerReport: number;
                            maxCharacters: number;
                            turns: number;
                            sent: number;
                            allowance: number;
                            available: number;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: {
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        text: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            date: string;
                            version: number;
                            dailyLimit: number;
                            turnsPerReport: number;
                            maxCharacters: number;
                            turns: number;
                            sent: number;
                            allowance: number;
                            available: number;
                            /** Format: uuid */
                            id: string;
                            /** Format: date-time */
                            createdAt: string;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/inventory/contents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    actorId?: string;
                    containerId: string;
                    after?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                label: string;
                                count?: number;
                                unitsPerSlot?: number | "unlimited";
                                slots: number;
                                totalSlots: number;
                                states?: string[];
                            }[];
                            /** Format: uuid */
                            next: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/inventory/bundles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: {
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        action: "create";
                        label: string;
                        itemIds: string[];
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        action: "add";
                        /** Format: uuid */
                        bundleId: string;
                        itemIds: string[];
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        action: "release";
                        /** Format: uuid */
                        bundleId: string;
                        /** Format: uuid */
                        itemId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        storageId: string;
                        /** @enum {string} */
                        action: "dissolve";
                        /** Format: uuid */
                        bundleId: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            bundleId: string;
                            itemCount: number;
                            normalSlots: number;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/notices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            notices: {
                                /** Format: uuid */
                                id: string;
                                /** Format: date-time */
                                at: string;
                                text: string;
                                unread: boolean;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/friends": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: {
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        action: "propose" | "remove";
                        /** Format: uuid */
                        targetId: string;
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        action: "accept" | "decline" | "withdraw";
                        /** Format: uuid */
                        offerId: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            offerId: string;
                            /** Format: uuid */
                            proposerId: string;
                            /** Format: uuid */
                            recipientId: string;
                            /** @enum {string} */
                            state: "pending" | "accepted" | "declined" | "withdrawn" | "removed";
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/viewers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: {
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        /**
                         * Format: uuid
                         * @description 本人の物・保管先・技能・状態のID
                         */
                        targetId: string;
                        /** @description 本人以外で読める参加者。allはその場の全員、配列は指定した人物だけで、空なら本人だけ */
                        viewers: "all" | string[];
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /**
                             * Format: uuid
                             * @description 本人の物・保管先・技能・状態のID
                             */
                            targetId: string;
                            /** @description 本人以外で読める参加者。allはその場の全員、配列は指定した人物だけで、空なら本人だけ */
                            viewers: "all" | string[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/npc-promotions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    before?: string;
                    after?: string;
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            [key: string]: unknown;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/npc-mode": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            active: boolean;
                            summary: string;
                            scenes: {
                                /** Format: uuid */
                                sceneId: string;
                                /** @enum {string|null} */
                                handoff: "available" | "processing" | null;
                                log: {
                                    /** @enum {string} */
                                    kind: "observation" | "intent";
                                    text: string;
                                }[];
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: {
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "away" | "return";
                    } | {
                        /** Format: uuid */
                        requestId: string;
                        /** @enum {string} */
                        command: "join" | "decline";
                        /** Format: uuid */
                        sceneId: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            active: boolean;
                            summary: string;
                            scenes: {
                                /** Format: uuid */
                                sceneId: string;
                                /** @enum {string|null} */
                                handoff: "available" | "processing" | null;
                                log: {
                                    /** @enum {string} */
                                    kind: "observation" | "intent";
                                    text: string;
                                }[];
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/presence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: {
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        connectionId: string;
                        active: boolean;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            connectionId: string;
                            active: boolean;
                            /** @enum {string} */
                            kind: "human" | "bot";
                            /** Format: date-time */
                            expiresAt: string;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/scene/inbox": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    actorId?: string;
                    after?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            viewerId: string;
                            /** @default [] */
                            opportunities: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                sceneId: string;
                                /** Format: uuid */
                                sourceInputId: string;
                                /** @enum {boolean} */
                                nextInput?: true;
                                /** Format: date-time */
                                deadline: string;
                                seenEventIds: string[];
                                context: string[];
                            }[];
                            /** @default [] */
                            proposals: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                sceneId: string;
                                /** Format: date-time */
                                deadline: string;
                            }[];
                            invitations: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                sceneId: string;
                                /** Format: date-time */
                                deadline: string;
                                context: string[];
                            }[];
                            items: {
                                id: string;
                                /** Format: uuid */
                                sceneId: string | null;
                                /** @enum {string} */
                                kind: "invitation" | "invitation_closed" | "participation_settled" | "scene_ready" | "scene_started" | "participant_left" | "result" | "presence_inactive" | "opportunity" | "end_proposal" | "paused";
                                /** Format: uuid */
                                invitationId?: string;
                                contact?: boolean;
                                /** @enum {string} */
                                contactOutcome?: "delivered" | "unreachable" | "unanswered";
                                /** Format: uuid */
                                opportunityId?: string;
                                /** Format: uuid */
                                sourceInputId?: string;
                                /** Format: uuid */
                                proposalId?: string;
                                /** Format: uuid */
                                requestId?: string;
                                /** @enum {string} */
                                answer?: "accepted" | "declined" | "expired";
                                /** Format: date-time */
                                deadline?: string;
                                context?: string[];
                            }[];
                            next: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        actionText: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            viewerId: string;
                            /** Format: uuid */
                            runId: string | null;
                            at: number;
                            /** @enum {string} */
                            state: "ready" | "running" | "paused";
                            error: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/play/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            viewerId: string;
                            /** Format: uuid */
                            runId: string | null;
                            at: number;
                            /** @enum {string} */
                            state: "ready" | "running" | "paused";
                            error: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/cursor": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    role: "admin" | "player";
                    actorId?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            cursor: string;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/player-cli/latest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            version: string;
                            node: string;
                            /** Format: starts_with */
                            downloadUrl: string;
                            sha256: string;
                            sizeBytes: number;
                            /** Format: starts_with */
                            setupUrl: string;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/account": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            member: {
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                role: "admin" | "user";
                                banned: boolean;
                                /** Format: date-time */
                                createdAt: string;
                            } | null;
                            inviteRequired: boolean;
                            bootstrapAvailable: boolean;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/operations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        command: {
                            /** @enum {string} */
                            operation: "inspection.select";
                            selection: {
                                /** Format: uuid */
                                worldId: string;
                                /** Format: uuid */
                                userId: string | null;
                                /** Format: uuid */
                                actorId: string;
                                /** Format: uuid */
                                endSceneId: string;
                                n: number;
                                /**
                                 * @default presentation-v3
                                 * @enum {string}
                                 */
                                metricVersion?: "presentation-v1" | "presentation-v2" | "presentation-v3";
                                /**
                                 * @default {
                                 *       "version": "unit-v1",
                                 *       "values": {
                                 *         "node": 1,
                                 *         "edge": 1,
                                 *         "aspect": 1,
                                 *         "update": 1
                                 *       },
                                 *       "rationale": "全区分1の未校正の基準値。満足度や意味的重要度を表さない。"
                                 *     }
                                 */
                                weights?: {
                                    version: string;
                                    values: {
                                        node: number;
                                        edge: number;
                                        aspect: number;
                                        update: number;
                                    };
                                    rationale: string;
                                };
                                /** @default 0 */
                                lowThreshold?: number;
                            };
                        } | {
                            /** @enum {string} */
                            operation: "inspection.read";
                            /** Format: uuid */
                            worldId: string;
                            manifestId: string;
                            after?: number;
                        } | {
                            /** @enum {string} */
                            operation: "inspection.evaluate";
                            /** Format: uuid */
                            worldId: string;
                            manifestId: string;
                            configuration: {
                                configurationVersion: number;
                                /** @enum {string} */
                                target: "default" | "resolution";
                                budgetUsd: number;
                            };
                        } | {
                            /** @enum {string} */
                            operation: "inspection.evaluation";
                            /** Format: uuid */
                            worldId: string;
                            /** Format: uuid */
                            id: string;
                        } | {
                            /** @enum {string} */
                            operation: "inspection.history";
                            query: {
                                /** Format: uuid */
                                worldId: string;
                                /** Format: date-time */
                                from: string;
                                /** Format: date-time */
                                to: string;
                                /** Format: uuid */
                                userId?: string | null;
                                /** Format: uuid */
                                actorId?: string;
                                n?: number;
                                metricVersion?: string;
                                weightVersion?: string;
                                model?: string;
                                configurationVersion?: number;
                                after?: number;
                            };
                        } | {
                            /** @enum {string} */
                            operation: "inspection.settings";
                            /** Format: uuid */
                            worldId: string;
                        } | {
                            /** @enum {string} */
                            operation: "inspection.configure";
                            /** Format: uuid */
                            worldId: string;
                            configuration: {
                                enabled: boolean;
                                intervalMinutes: number;
                                periodHours: number;
                                n: number;
                                lowThreshold: number;
                                weights: {
                                    version: string;
                                    values: {
                                        node: number;
                                        edge: number;
                                        aspect: number;
                                        update: number;
                                    };
                                    rationale: string;
                                };
                                evaluation: {
                                    configurationVersion: number;
                                    /** @enum {string} */
                                    target: "default" | "resolution";
                                    budgetUsd: number;
                                } | null;
                                sampleCount: number;
                            };
                            expectedVersion: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "requests.read";
                            /** Format: uuid */
                            id: string;
                        } | {
                            /** @enum {string} */
                            operation: "mcp.clients.list";
                            /** Format: uuid */
                            before?: string;
                        } | {
                            /** @enum {string} */
                            operation: "mcp.clients.put";
                            /** Format: uuid */
                            clientId: string;
                            configuration: {
                                name: string;
                                enabled: boolean;
                                redirectUris: string[];
                                scopes: string[];
                                worldIds: string[] | null;
                            };
                            advertisedReadScopes?: string[];
                            expectedVersion: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "mcp.grants.list";
                            /** Format: uuid */
                            before?: string;
                        } | {
                            /** @enum {string} */
                            operation: "mcp.grants.revoke";
                            /** Format: uuid */
                            grantId: string;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "worlds.list";
                            /** Format: uuid */
                            before?: string;
                        } | {
                            /** @enum {string} */
                            operation: "worlds.read";
                            /** Format: uuid */
                            worldId: string;
                        } | {
                            /** @enum {string} */
                            operation: "worlds.records";
                            /** Format: uuid */
                            worldId: string;
                            before?: string;
                        } | {
                            /** @enum {string} */
                            operation: "worlds.create";
                            prompt: string;
                            playerSettings?: string;
                            budgetUsd: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "worlds.command";
                            /** Format: uuid */
                            worldId: string;
                            command: {
                                /** @enum {string} */
                                command: "advance";
                                /** @description 管理者が追加する期間。ミリ秒表記で、1日以上かつ1日の整数倍 */
                                duration: number;
                            } | {
                                /** @enum {string} */
                                command: "resume" | "finish";
                            };
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "worlds.graph";
                            /** Format: uuid */
                            worldId: string;
                            query: {
                                /** @enum {string} */
                                kind: "inventory";
                                minCount: number;
                                standard?: boolean;
                            } | {
                                /** @enum {string} */
                                kind: "edge";
                                /** Format: uuid */
                                id: string;
                            } | {
                                /** @enum {string} */
                                kind: "nodes";
                                /** Format: uuid */
                                after?: string;
                            } | {
                                /** @enum {string} */
                                kind: "node";
                                /** Format: uuid */
                                id: string;
                                at?: number;
                            } | {
                                /** @enum {string} */
                                kind: "relations";
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                relation: "has" | "effect" | "happen" | "see" | "interpret" | "status";
                                /** @enum {string} */
                                direction: "in" | "out";
                                at: number;
                                through?: number;
                                /** Format: uuid */
                                after?: string;
                            } | {
                                /** @enum {string} */
                                kind: "history";
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                relation: "has" | "effect" | "happen" | "see" | "interpret" | "status";
                                /** @enum {string} */
                                direction: "in" | "out";
                                through: number;
                                /** @default 0 */
                                from?: number;
                                after?: {
                                    from: number;
                                    /** Format: uuid */
                                    id: string;
                                };
                            } | {
                                /** @enum {string} */
                                kind: "receipts";
                                /** Format: uuid */
                                after?: string;
                            };
                        } | {
                            /** @enum {string} */
                            operation: "worlds.edit";
                            /** Format: uuid */
                            worldId: string;
                            at: number;
                            dependencies: {
                                key: string;
                                version: number;
                            }[];
                            changes: {
                                nodes: ({
                                    /** Format: uuid */
                                    id: string;
                                    /** @description 同一性を参照するための呼称・識別用ラベル。職業・所属・居場所・性質・状態の事実はscriptとstatusで表す */
                                    text: string;
                                    /** @enum {string} */
                                    kind: "existence";
                                    /** @description 物品の個数。無い物品は、個数を数えないひとまとまり */
                                    count?: number;
                                    /**
                                     * Format: uuid
                                     * @description 管理者が指定する物品の系列ID
                                     */
                                    seriesId?: string;
                                    unitsPerSlot?: number | "unlimited";
                                    storageLimitSlots?: number;
                                    /** @description 本人以外で読める参加者。allはその場の全員、配列は指定した人物だけで、空なら本人だけ。省くと、手にしている物と状態は全員、技能と保管先の中身は本人だけ */
                                    viewers?: "all" | string[];
                                } | {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    /** @enum {string} */
                                    kind: "script";
                                    name?: string;
                                    derivedFromSkills?: string[];
                                    /** @enum {string} */
                                    type?: "memo" | "draw-source";
                                    drawTable?: {
                                        /** Format: uuid */
                                        versionId: string;
                                        /** Format: uuid */
                                        managerId: string;
                                        entries: {
                                            /** Format: uuid */
                                            entryId: string;
                                            weight: number;
                                            result: {
                                                /** @enum {string} */
                                                kind: "item";
                                                label: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "skill";
                                                text: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "message";
                                                text: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "stock";
                                                /** Format: uuid */
                                                storageId: string;
                                                /** Format: uuid */
                                                itemId: string;
                                                count: number;
                                            };
                                        }[];
                                        price: {
                                            /** Format: uuid */
                                            storageId: string;
                                            /** Format: uuid */
                                            paymentSeriesId: string;
                                            paymentLabel: string;
                                            count: number;
                                        } | null;
                                    };
                                    spawn?: {
                                        /** @enum {string} */
                                        kind: "instant-npc" | "existence" | "script" | "event";
                                        species: string;
                                        description: string;
                                        probability: number;
                                        /** @description 出現個体が品物と引き換えに受け取る代価の系列・呼称・個数。spawn-tradeで個体の発生用ノードへ結んだ品物に指定する */
                                        price?: {
                                            /** Format: uuid */
                                            seriesId: string;
                                            label: string;
                                            count: number;
                                        };
                                        minCount: number;
                                        maxCount: number;
                                    } | {
                                        /** @enum {string} */
                                        kind: "instant-npc" | "existence" | "script" | "event";
                                        species: string;
                                        description: string;
                                        probability: number;
                                        /** @description 出現個体が品物と引き換えに受け取る代価の系列・呼称・個数。spawn-tradeで個体の発生用ノードへ結んだ品物に指定する */
                                        price?: {
                                            /** Format: uuid */
                                            seriesId: string;
                                            label: string;
                                            count: number;
                                        };
                                        count: number;
                                    };
                                    /** @description 本人以外で読める参加者。allはその場の全員、配列は指定した人物だけで、空なら本人だけ。省くと、手にしている物と状態は全員、技能と保管先の中身は本人だけ */
                                    viewers?: "all" | string[];
                                } | {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    /** @enum {string} */
                                    kind: "event";
                                    appearances?: {
                                        /** @enum {string} */
                                        kind: "instant-npc" | "existence" | "script" | "event";
                                        species: string;
                                        description: string;
                                        /** Format: uuid */
                                        id: string;
                                        /** @description 出現した一団の個体数、または一つにまとまった物品の個数 */
                                        count?: number;
                                        /**
                                         * Format: uuid
                                         * @description 出現させた発生用ノード。個体が死亡したときのドロップの抽選に使う
                                         */
                                        ruleId?: string;
                                    }[];
                                    instantActor?: {
                                        /** Format: uuid */
                                        id: string;
                                        /** Format: uuid */
                                        sourceEventId: string;
                                    };
                                    instantTarget?: {
                                        /** Format: uuid */
                                        id: string;
                                        /** Format: uuid */
                                        sourceEventId: string;
                                    };
                                    instantReduction?: {
                                        /** Format: uuid */
                                        targetId: string;
                                        /** @enum {string} */
                                        kind: "death" | "separation";
                                        count: number;
                                        remaining: number;
                                        /** Format: uuid */
                                        separatedId?: string;
                                    };
                                    period: {
                                        from: number;
                                        until?: number;
                                    };
                                })[];
                                /** @default [] */
                                revisions?: ({
                                    /** Format: uuid */
                                    id: string;
                                    /** @description 同一性を参照するための呼称・識別用ラベル。職業・所属・居場所・性質・状態の事実はscriptとstatusで表す */
                                    text: string;
                                    /** @enum {string} */
                                    kind: "existence";
                                    /** @description 物品の個数。無い物品は、個数を数えないひとまとまり */
                                    count?: number;
                                    /**
                                     * Format: uuid
                                     * @description 管理者が指定する物品の系列ID
                                     */
                                    seriesId?: string;
                                    unitsPerSlot?: number | "unlimited";
                                    storageLimitSlots?: number;
                                    /** @description 本人以外で読める参加者。allはその場の全員、配列は指定した人物だけで、空なら本人だけ。省くと、手にしている物と状態は全員、技能と保管先の中身は本人だけ */
                                    viewers?: "all" | string[];
                                } | {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    /** @enum {string} */
                                    kind: "script";
                                    name?: string;
                                    derivedFromSkills?: string[];
                                    /** @enum {string} */
                                    type?: "memo" | "draw-source";
                                    drawTable?: {
                                        /** Format: uuid */
                                        versionId: string;
                                        /** Format: uuid */
                                        managerId: string;
                                        entries: {
                                            /** Format: uuid */
                                            entryId: string;
                                            weight: number;
                                            result: {
                                                /** @enum {string} */
                                                kind: "item";
                                                label: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "skill";
                                                text: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "message";
                                                text: string;
                                            } | {
                                                /** @enum {string} */
                                                kind: "stock";
                                                /** Format: uuid */
                                                storageId: string;
                                                /** Format: uuid */
                                                itemId: string;
                                                count: number;
                                            };
                                        }[];
                                        price: {
                                            /** Format: uuid */
                                            storageId: string;
                                            /** Format: uuid */
                                            paymentSeriesId: string;
                                            paymentLabel: string;
                                            count: number;
                                        } | null;
                                    };
                                    spawn?: {
                                        /** @enum {string} */
                                        kind: "instant-npc" | "existence" | "script" | "event";
                                        species: string;
                                        description: string;
                                        probability: number;
                                        /** @description 出現個体が品物と引き換えに受け取る代価の系列・呼称・個数。spawn-tradeで個体の発生用ノードへ結んだ品物に指定する */
                                        price?: {
                                            /** Format: uuid */
                                            seriesId: string;
                                            label: string;
                                            count: number;
                                        };
                                        minCount: number;
                                        maxCount: number;
                                    } | {
                                        /** @enum {string} */
                                        kind: "instant-npc" | "existence" | "script" | "event";
                                        species: string;
                                        description: string;
                                        probability: number;
                                        /** @description 出現個体が品物と引き換えに受け取る代価の系列・呼称・個数。spawn-tradeで個体の発生用ノードへ結んだ品物に指定する */
                                        price?: {
                                            /** Format: uuid */
                                            seriesId: string;
                                            label: string;
                                            count: number;
                                        };
                                        count: number;
                                    };
                                    /** @description 本人以外で読める参加者。allはその場の全員、配列は指定した人物だけで、空なら本人だけ。省くと、手にしている物と状態は全員、技能と保管先の中身は本人だけ */
                                    viewers?: "all" | string[];
                                } | {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    /** @enum {string} */
                                    kind: "event";
                                    appearances?: {
                                        /** @enum {string} */
                                        kind: "instant-npc" | "existence" | "script" | "event";
                                        species: string;
                                        description: string;
                                        /** Format: uuid */
                                        id: string;
                                        /** @description 出現した一団の個体数、または一つにまとまった物品の個数 */
                                        count?: number;
                                        /**
                                         * Format: uuid
                                         * @description 出現させた発生用ノード。個体が死亡したときのドロップの抽選に使う
                                         */
                                        ruleId?: string;
                                    }[];
                                    instantActor?: {
                                        /** Format: uuid */
                                        id: string;
                                        /** Format: uuid */
                                        sourceEventId: string;
                                    };
                                    instantTarget?: {
                                        /** Format: uuid */
                                        id: string;
                                        /** Format: uuid */
                                        sourceEventId: string;
                                    };
                                    instantReduction?: {
                                        /** Format: uuid */
                                        targetId: string;
                                        /** @enum {string} */
                                        kind: "death" | "separation";
                                        count: number;
                                        remaining: number;
                                        /** Format: uuid */
                                        separatedId?: string;
                                    };
                                    period: {
                                        from: number;
                                        until?: number;
                                    };
                                })[];
                                edges: {
                                    /** Format: uuid */
                                    id: string;
                                    /** @enum {string} */
                                    kind: "has" | "effect" | "happen" | "see" | "interpret" | "status";
                                    /** Format: uuid */
                                    source: string;
                                    /** Format: uuid */
                                    target: string;
                                    /**
                                     * @description status/interpretはcontentかabout。hasの役割なしは、存在へ向くと物品を持つこと、記述へ向くと記録やメモを持つこと。useは家・場所の保管先の登録。use・skill・summaryと物品を持つhasは実行側だけが記録する
                                     * @enum {string}
                                     */
                                    role?: "content" | "about" | "use" | "skill" | "summary";
                                    /** @description 関係の内容。seeでは受容本文。status/contentでtext=locationは主体の現在の所在専用のscriptを示し、status/aboutで場所を参照する */
                                    text?: string;
                                    period: {
                                        from: number;
                                        until?: number;
                                    };
                                    observation?: {
                                        /** @description 受容した側面・範囲。textがない場合は、受容内容の本文も含める */
                                        aspect: string;
                                        through: number;
                                        /** @default [] */
                                        sourceIds?: string[];
                                        /** @default [] */
                                        pathIds?: string[];
                                        /** @description サーバーが確定時に保存する版。モデルからの値は使用しない */
                                        versions?: {
                                            [key: string]: number;
                                        };
                                    };
                                    commandRestrictions?: ("say" | "move" | "vehicle-travel")[];
                                    stateOrigin?: {
                                        /** Format: uuid */
                                        requestId: string;
                                        /** Format: uuid */
                                        actorId: string;
                                        /** Format: uuid */
                                        attachedItemId?: string;
                                        /** @enum {boolean} */
                                        affectsMovement?: true;
                                    };
                                }[];
                                endEdges: string[];
                            };
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "backups.read";
                        } | {
                            /** @enum {string} */
                            operation: "backups.jobs";
                            before?: string;
                        } | {
                            /** @enum {string} */
                            operation: "backups.list";
                            before?: string;
                        } | {
                            /** @enum {string} */
                            operation: "backups.job";
                            /** Format: uuid */
                            id: string;
                        } | {
                            /** @enum {string} */
                            operation: "backups.configure";
                            configuration: {
                                enabled: boolean;
                                intervalHours: number;
                                retentionDays: number;
                                password: string;
                                repository: string;
                                accessKey: string;
                                secretKey: string;
                                region: string;
                            } | {
                                enabled: boolean;
                                intervalHours: number;
                                retentionDays: number;
                                password: string;
                                /** @enum {string} */
                                repository: "local";
                            };
                            expectedVersion: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "backups.create";
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "backups.restore";
                            snapshot: string;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "monitor.samples";
                            query: {
                                before?: string;
                            };
                        } | {
                            /** @enum {string} */
                            operation: "monitor.notifications";
                            query: {
                                before?: string;
                            };
                        } | {
                            /** @enum {string} */
                            operation: "monitorWebhook.put";
                            /** Format: uri */
                            url: string | null;
                            expectedVersion: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "runtime.read";
                        } | {
                            /** @enum {string} */
                            operation: "runtime.put";
                            configuration: {
                                paused: boolean;
                                /** Format: date-time */
                                worldEditsUntil?: string;
                                concurrency: number | null;
                                sampleIntervalSeconds: number;
                                retentionDays: number;
                                thresholds: {
                                    [key: string]: number;
                                };
                            };
                            expectedVersion: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "jobs.list";
                            query: {
                                /** @enum {string} */
                                kind?: "construction" | "scene" | "join";
                                /** Format: uuid */
                                worldId?: string;
                                /** Format: uuid */
                                userId?: string;
                                /** Format: uuid */
                                before?: string;
                            };
                        } | {
                            /** @enum {string} */
                            operation: "jobs.read";
                            /** @enum {string} */
                            kind: "construction" | "scene" | "join";
                            /** Format: uuid */
                            id: string;
                        } | {
                            /** @enum {string} */
                            operation: "jobs.resume";
                            /** @enum {string} */
                            kind: "construction" | "scene" | "join";
                            /** Format: uuid */
                            id: string;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "playSessions.list";
                            /** Format: uuid */
                            worldId: string;
                        } | {
                            /** @enum {string} */
                            operation: "playSessions.advance";
                            /** Format: uuid */
                            worldId: string;
                            /** Format: uuid */
                            sessionId: string;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "costs.read";
                            query: {
                                /** Format: date-time */
                                from: string;
                                /** Format: date-time */
                                to: string;
                                /** @enum {string|null} */
                                provider?: "deepseek" | "gemini" | "openai" | "anthropic" | "openrouter" | null;
                                model?: string;
                                /** Format: uuid */
                                worldId?: string | null;
                                /** Format: uuid */
                                userId?: string | null;
                                task?: string | null;
                                /** Format: uuid */
                                responseId?: string;
                                /** Format: uuid */
                                operationId?: string;
                                /** Format: uuid */
                                callId?: string;
                                /** @enum {string} */
                                view: "summary" | "calls" | "timeline" | "groups";
                                /**
                                 * @default day
                                 * @enum {string}
                                 */
                                interval?: "hour" | "day" | "month";
                                /** @enum {string} */
                                by?: "user" | "task" | "model";
                                /** @enum {string} */
                                order?: "calls" | "cost";
                                limit?: number;
                                after?: string;
                            };
                        } | {
                            /** @enum {string} */
                            operation: "playUsage.read";
                            query: {
                                /** Format: uuid */
                                worldId: string;
                                /** Format: date-time */
                                from: string;
                                /** Format: date-time */
                                to: string;
                            };
                        } | {
                            /** @enum {string} */
                            operation: "models.read";
                        } | {
                            /** @enum {string} */
                            operation: "models.put";
                            configuration: {
                                default: {
                                    /** @enum {string} */
                                    provider: "deepseek" | "gemini" | "openai" | "anthropic" | "openrouter";
                                    model: string;
                                    /** Format: uri */
                                    baseUrl: string;
                                    /** @enum {string} */
                                    api: "chat-completions" | "responses" | "messages";
                                    /** @enum {string} */
                                    effort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
                                    /** @enum {string} */
                                    initialEffort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
                                    contextTokens: number;
                                    maxOutputTokens: number;
                                    inputUsdPerMillion: number;
                                    cachedInputUsdPerMillion: number;
                                    cacheWrite5mUsdPerMillion?: number;
                                    cacheWrite1hUsdPerMillion?: number;
                                    cacheWrite30mUsdPerMillion?: number;
                                    cacheWrite12hUsdPerMillion?: number;
                                    cacheStorageUsdPerMillionTokenHour?: number;
                                    outputUsdPerMillion: number;
                                    /** Format: date */
                                    pricingDate: string;
                                };
                                resolution: {
                                    /** @enum {string} */
                                    provider: "deepseek" | "gemini" | "openai" | "anthropic" | "openrouter";
                                    model: string;
                                    /** Format: uri */
                                    baseUrl: string;
                                    /** @enum {string} */
                                    api: "chat-completions" | "responses" | "messages";
                                    /** @enum {string} */
                                    effort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
                                    /** @enum {string} */
                                    initialEffort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
                                    contextTokens: number;
                                    maxOutputTokens: number;
                                    inputUsdPerMillion: number;
                                    cachedInputUsdPerMillion: number;
                                    cacheWrite5mUsdPerMillion?: number;
                                    cacheWrite1hUsdPerMillion?: number;
                                    cacheWrite30mUsdPerMillion?: number;
                                    cacheWrite12hUsdPerMillion?: number;
                                    cacheStorageUsdPerMillionTokenHour?: number;
                                    outputUsdPerMillion: number;
                                    /** Format: date */
                                    pricingDate: string;
                                };
                                /** @enum {string} */
                                judgment: "separate" | "combined";
                            };
                            expectedVersion: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "credentials.put";
                            /** @enum {string} */
                            provider: "deepseek" | "gemini" | "openai" | "anthropic" | "openrouter";
                            value: string;
                            expectedVersion: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "worldBudgets.read";
                            /** Format: uuid */
                            worldId: string;
                        } | {
                            /** @enum {string} */
                            operation: "worldBudgets.put";
                            /** Format: uuid */
                            worldId: string;
                            budgetUsd: number;
                            expectedVersion: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "responseLimits.read";
                        } | {
                            /** @enum {string} */
                            operation: "playPolicy.read";
                        } | {
                            /** @enum {string} */
                            operation: "reportPolicy.read";
                        } | {
                            /** @enum {string} */
                            operation: "reportPolicy.put";
                            dailyLimit: number;
                            turnsPerReport: number;
                            maxCharacters: number;
                            expectedVersion: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "reports.list";
                            /** Format: uuid */
                            worldId: string;
                            /** Format: uuid */
                            before?: string;
                        } | {
                            /** @enum {string} */
                            operation: "stories.list";
                            /** Format: date */
                            since?: string;
                            /** Format: date */
                            until?: string;
                            /** Format: uuid */
                            worldId?: string;
                            author?: string;
                            player?: string;
                            title?: string;
                            /** @enum {string} */
                            bookmarked?: "1";
                            /** @enum {string} */
                            sort?: "updated" | "newest" | "oldest" | "player" | "author" | "title";
                            /** Format: uuid */
                            before?: string;
                        } | {
                            /** @enum {string} */
                            operation: "stories.read";
                            /** Format: uuid */
                            storyId: string;
                            /** Format: date */
                            since?: string;
                            /** Format: date */
                            until?: string;
                            /** @enum {string} */
                            sort?: "number" | "newest" | "oldest";
                            after?: string;
                            episode?: string;
                        } | {
                            /** @enum {string} */
                            operation: "stories.stats";
                            /** Format: uuid */
                            worldId: string;
                            /** Format: date */
                            since?: string;
                            /** Format: date */
                            until?: string;
                        } | {
                            /** @enum {string} */
                            operation: "activity.read";
                            /** Format: uuid */
                            worldId: string;
                            days: string[];
                        } | {
                            /** @enum {string} */
                            operation: "blueprints.create";
                            /** Format: uuid */
                            worldId: string;
                            template: {
                                /** @enum {string} */
                                mode: "build" | "open" | "build-and-open" | "craft";
                                name: string;
                                version: number;
                                /** Format: uuid */
                                authorId: string;
                                /** @description 製作した物を保管先として設置し、許可する利用条件 */
                                installation?: {
                                    relocatable: boolean;
                                    pickup: ("public" | "addressed")[];
                                };
                                /** @description プレイヤーに示す使い方と、完成後にできること */
                                instructions: string;
                                /** @description 建築・製作に必要な消費材と道具。開店のみの場合は省く */
                                materials?: {
                                    label: string;
                                    count: number;
                                    /** @enum {string} */
                                    usage: "consume" | "tool";
                                }[];
                                /** @description 原案者と一緒に下書きを試せる人物 */
                                testerIds?: string[];
                            };
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "blueprints.publish";
                            /** Format: uuid */
                            worldId: string;
                            template: {
                                /** @enum {string} */
                                mode: "build" | "open" | "build-and-open" | "craft";
                                name: string;
                                version: number;
                                /** Format: uuid */
                                authorId: string;
                            } | {
                                /** Format: uuid */
                                templateId: string;
                            };
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "notices.send";
                            /** Format: uuid */
                            worldId: string;
                            text: string;
                            /** @description 宛先の人物。省くと、サーバー担当のNPCを除く、操作中の人物全員 */
                            actorIds?: string[];
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "npcs.promotions";
                            /** Format: uuid */
                            worldId: string;
                            /** Format: uuid */
                            before?: string;
                        } | {
                            /** @enum {string} */
                            operation: "npcs.decidePromotion";
                            /** Format: uuid */
                            worldId: string;
                            /** Format: uuid */
                            promotionId: string;
                            approve: boolean;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "npcs.read";
                            /** Format: uuid */
                            worldId: string;
                        } | {
                            /** @enum {string} */
                            operation: "promotionPolicy.read";
                            /** Format: uuid */
                            worldId: string;
                        } | {
                            /** @enum {string} */
                            operation: "promotionPolicy.put";
                            /** Format: uuid */
                            worldId: string;
                            /** @description 明確に合致すれば承認する条件。空欄で手動判断のみ */
                            condition: string;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "creationPolicy.read";
                            /** Format: uuid */
                            worldId: string;
                        } | {
                            /** @enum {string} */
                            operation: "creationPolicy.put";
                            /** Format: uuid */
                            worldId: string;
                            /** @description 新規作成のダイスをGMが設定するときの基準。空欄で既定の基準 */
                            criteria: string;
                            /** @description 失敗時のファンブルをGMが設定するときの基準。空欄で既定の基準。省略すると現在の設定を保つ */
                            fumbleCriteria?: string;
                            /** @description 基準の文をプレイヤーのstatusに表示する。省略すると現在の設定を保つ。初期値は非表示 */
                            shown?: boolean;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "npcs.put";
                            /** Format: uuid */
                            worldId: string;
                            /** Format: uuid */
                            actorId: string;
                            /** @enum {string|null} */
                            controller: "bot" | "server" | null;
                            /** Format: uuid */
                            userId?: string;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "playPolicy.put";
                            turnCalls: number;
                            receiptTimeoutSeconds: number;
                            expectedVersion: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "responseLimits.put";
                            calls: number;
                            expectedVersion: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "modelLimits.read";
                            name: string;
                        } | {
                            /** @enum {string} */
                            operation: "modelLimits.put";
                            name: string;
                            limits: {
                                concurrency?: number;
                                requestsPerMinute?: number;
                                tokensPerMinute?: number;
                            } | null;
                            expectedVersion: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "worlds.join";
                            /** Format: uuid */
                            worldId: string;
                            name?: string;
                            /** Format: uuid */
                            presetId?: string;
                            presetVersion?: number;
                            character?: string;
                            /** @description この人物をリスポーンなしで作成する。省略すると世界の設定に従う */
                            disableRespawn?: boolean;
                        } | {
                            /** @enum {string} */
                            operation: "worlds.resumeJoin";
                            /** Format: uuid */
                            joinId: string;
                        } | {
                            /** @enum {string} */
                            operation: "worlds.disableActorRespawn";
                            /** Format: uuid */
                            worldId: string;
                            /** Format: uuid */
                            actorId: string;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "worlds.configure";
                            /** Format: uuid */
                            worldId: string;
                            /** @description この世界のアカウントごとの日次SP上限。既定は100。省略すると現在の設定を保つ */
                            dailySpLimit?: number;
                            /** @description 所持・保管枠の制限を有効にする */
                            inventoryCapacity?: boolean;
                            inventoryLimits?: {
                                /** @description 人物の手持ち枠 */
                                carrySlots?: number;
                                /** @description 保管庫の標準枠 */
                                storageSlots?: number;
                                /** @description バンドルに収められる通常枠の合計。既定は15 */
                                bundleSlots?: number;
                                /** @description 物品の1枠あたりの標準個数 */
                                unitsPerSlot?: number;
                                /** @description 人物の技能枠。既定は50。手持ち枠の有効・無効にかかわらず適用する */
                                skillSlots?: number;
                            };
                            title: string;
                            description: string;
                            playerSettings?: string;
                            published: boolean;
                            accepting: boolean;
                            /** @description いま出会えるフレンドと居場所の一覧（players）を参加者へ提供する。省略すると現在の設定を保つ */
                            playerList?: boolean;
                            /** @description 検索で出現した個体が同じ場所に同時に同席できる数を、発生用ノードの発生数（maxCount、旧形式はcount）の何倍までにするか。既定は2。省略すると現在の設定を保つ */
                            instantNpcMultiplier?: number;
                            /** @description 参加する人物が最初から手に持つ系列つきの物品。設定後に始まる参加から適用する。省略すると現在の設定を保つ */
                            startingItems?: {
                                /** @description 物品の呼称 */
                                label: string;
                                /** @description 個数 */
                                count: number;
                                /**
                                 * Format: uuid
                                 * @description 物品の系列ID
                                 */
                                seriesId: string;
                                /** @description 1枠あたりの個数。省くと世界の標準、unlimitedなら何個でも1枠 */
                                unitsPerSlot?: number | "unlimited";
                            }[];
                            /** @description プレイヤーとユニークNPCを対抗行動の死亡判定の対象にする。既定は有効。省略すると現在の設定を保つ */
                            deathJudgment?: boolean;
                            /** @description 死亡した人物を復帰させる。既定は有効。無効なら死亡後はその人物で操作できない。省略すると現在の設定を保つ */
                            respawnEnabled?: boolean;
                            /** @description 人物の死亡を判定するGMへ渡す、この世界の条件文。空なら行動と結果だけから判定する。省略すると現在の設定を保つ */
                            deathCriteria?: string;
                            /**
                             * Format: uuid
                             * @description Homeが未設定の人物の復帰先。nullなら本人の最初の所在地へ移す。省略すると現在の設定を保つ
                             */
                            deathPlaceId?: string | null;
                            /** @description 非戦闘地域。範囲の場所IDと、古い地理記録を補う場所IDを指定する。両方の内部にあたる part-of の子にも適用する。空配列で解除し、省略すると現在の設定を保つ */
                            nonCombatAreas?: {
                                /** Format: uuid */
                                rootId: string;
                                memberPlaceIds: string[];
                            }[];
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "presets.put";
                            /** Format: uuid */
                            presetId: string;
                            title: string;
                            description: string;
                            settings: string;
                            expectedVersion: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "presets.list";
                            /** Format: uuid */
                            before?: string;
                        } | {
                            /** @enum {string} */
                            operation: "account.claim";
                            version: string;
                        } | {
                            /** @enum {string} */
                            operation: "account.register";
                            invitation?: string;
                        } | {
                            /** @enum {string} */
                            operation: "settings.read";
                        } | {
                            /** @enum {string} */
                            operation: "settings.invites";
                            enabled: boolean;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "users.list";
                            /** Format: uuid */
                            before?: string;
                        } | {
                            /** @enum {string} */
                            operation: "users.role";
                            /** Format: uuid */
                            userId: string;
                            /** @enum {string} */
                            role: "admin" | "user";
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "users.ban";
                            /** Format: uuid */
                            userId: string;
                            banned: boolean;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "invites.create";
                            /** Format: date-time */
                            expiresAt: string;
                            maxUses: number;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "invites.list";
                            /** Format: uuid */
                            before?: string;
                        } | {
                            /** @enum {string} */
                            operation: "invites.uses";
                            /** Format: uuid */
                            inviteId: string;
                            /** Format: uuid */
                            before?: string;
                        } | {
                            /** @enum {string} */
                            operation: "invites.revoke";
                            /** Format: uuid */
                            inviteId: string;
                            reason: string;
                        } | {
                            /** @enum {string} */
                            operation: "audit.list";
                            before?: string;
                        };
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            result: ({
                                manifest: {
                                    id: string;
                                    /** @enum {string} */
                                    recordVersion: "inspection-record-v1" | "inspection-record-v2" | "inspection-record-v3";
                                    /** Format: date-time */
                                    capturedAt: string;
                                    selection: {
                                        /** Format: uuid */
                                        worldId: string;
                                        /** Format: uuid */
                                        userId: string | null;
                                        /** Format: uuid */
                                        actorId: string;
                                        /** Format: uuid */
                                        endSceneId: string;
                                        n: number;
                                        /**
                                         * @default presentation-v3
                                         * @enum {string}
                                         */
                                        metricVersion: "presentation-v1" | "presentation-v2" | "presentation-v3";
                                        /**
                                         * @default {
                                         *       "version": "unit-v1",
                                         *       "values": {
                                         *         "node": 1,
                                         *         "edge": 1,
                                         *         "aspect": 1,
                                         *         "update": 1
                                         *       },
                                         *       "rationale": "全区分1の未校正の基準値。満足度や意味的重要度を表さない。"
                                         *     }
                                         */
                                        weights: {
                                            version: string;
                                            values: {
                                                node: number;
                                                edge: number;
                                                aspect: number;
                                                update: number;
                                            };
                                            rationale: string;
                                        };
                                        /** @default 0 */
                                        lowThreshold: number;
                                    };
                                    requestedScenes: number;
                                    actualScenes: number;
                                    declaredContext?: {
                                        character: {
                                            /** Format: uuid */
                                            presetId: string | null;
                                            version: number | null;
                                            settings: string;
                                            registrationAt: number;
                                        } | null;
                                        preparations: {
                                            /** Format: uuid */
                                            sceneId: string;
                                            purpose: string | null;
                                            /** Format: date-time */
                                            createdAt: string;
                                        }[];
                                        /** @enum {string} */
                                        timeBasis: "world-clock-is-not-character-history";
                                    };
                                    priorMissingScenes: string[];
                                    /**
                                     * @default missing
                                     * @enum {string}
                                     */
                                    initialRecording: "recorded" | "missing";
                                    sceneOrder: {
                                        /** Format: uuid */
                                        id: string;
                                        revision: string;
                                        state: string;
                                    }[];
                                };
                                measurement: {
                                    manifestId: string;
                                    metricVersion: string;
                                    weights: {
                                        version: string;
                                        values: {
                                            node: number;
                                            edge: number;
                                            aspect: number;
                                            update: number;
                                        };
                                        rationale: string;
                                    };
                                    requestedScenes: number;
                                    actualScenes: number;
                                    /** @default true */
                                    initialMissing: boolean;
                                    /** @enum {string} */
                                    status: "complete" | "partial";
                                    total: {
                                        counts: {
                                            node: number;
                                            edge: number;
                                            aspect: number;
                                            update: number;
                                        };
                                        origins: {
                                            reference: number;
                                            generated: number;
                                        };
                                        observedValue: number;
                                        value: number | null;
                                        coverage: {
                                            presentations: number;
                                            mapped: number;
                                            ratio: number | null;
                                            /** @enum {string} */
                                            adequacy?: "unreviewed";
                                        };
                                        missing: string[];
                                        calls: number;
                                        calculatedNanoUsd: string | null;
                                        knownNanoUsd: string;
                                        costMissing: boolean;
                                        modelCallMs: number | null;
                                        responseWaitMs: number | null;
                                        perUsd: number | null;
                                        perWaitSecond: number | null;
                                        inputCount: number;
                                        perInput: number | null;
                                    };
                                    missingScenes: string[];
                                    priorMissingScenes: string[];
                                    lowRuns: {
                                        inputIds: string[];
                                        length: number;
                                    }[];
                                    longestLowRun: number;
                                    limitations: string[];
                                };
                                items: {
                                    id: string;
                                    /** @enum {string} */
                                    section: "initial" | "prior" | "scene" | "input" | "presentation" | "call" | "administrator" | "measure-scene" | "measure-diff";
                                    /** Format: uuid */
                                    sceneId: string | null;
                                    /** Format: uuid */
                                    inputId: string | null;
                                    value: unknown;
                                }[];
                                next: number | null;
                                fetched: {
                                    offset: number;
                                    count: number;
                                    total: number;
                                    complete: boolean;
                                };
                                retention: string;
                            } & {
                                [key: string]: unknown;
                            }) | {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/catalog/worlds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    before?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                title: string;
                                description: string;
                                playerSettings?: string;
                                accepting: boolean;
                                canJoin: boolean;
                            }[];
                            /** Format: uuid */
                            next: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/catalog/worlds/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            title: string;
                            description: string;
                            playerSettings?: string;
                            accepting: boolean;
                            canJoin: boolean;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/catalog/presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    before?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                title: string;
                                description: string;
                                version: number;
                            }[];
                            /** Format: uuid */
                            next: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/players": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    before?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                actorId: string | null;
                                /** @enum {string} */
                                state: "joining" | "ready" | "paused";
                                name?: string | null;
                                icon?: string | null;
                                at: number;
                            }[];
                            /** Format: uuid */
                            next: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/players/{playerId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    playerId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            player: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                actorId: string | null;
                                /** @enum {string} */
                                state: "joining" | "ready" | "paused";
                                name?: string | null;
                                icon?: string | null;
                                at: number;
                            } | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worlds/{id}/players/{playerId}/icon": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    playerId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        image: string | null;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            image: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/account/legacy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    before?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            subjectId: string;
                            version: string;
                            linked: boolean;
                            total: number;
                            items: {
                                /** Format: uuid */
                                id: string;
                                prompt: string;
                                /** Format: uuid */
                                actorId: string | null;
                            }[];
                            /** Format: uuid */
                            next: string | null;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/player-devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        requestId: string;
                        /** Format: uuid */
                        worldId: string;
                        secret: string;
                        character?: string;
                        icon?: string | null;
                    };
                };
            };
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            userCode: string;
                            verificationPath: string;
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/player-device": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Default Response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            worldId: string;
                            /** Format: uuid */
                            actorId: string | null;
                            /** Format: uuid */
                            joinId: string | null;
                            /** Format: uuid */
                            presetId: string | null;
                            presetVersion: number | null;
                            character?: string;
                            /** @enum {string} */
                            state: "authorization_pending" | "authorized" | "joining" | "paused" | "ready";
                        };
                    };
                };
                /** @description Default Response */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
                /** @description Default Response */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            message: string;
                            callsUsed?: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
