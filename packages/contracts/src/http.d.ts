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
                            /** Format: uuid */
                            id: string;
                            prompt: string;
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
                            /** Format: uuid */
                            id: string;
                            prompt: string;
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
                            /** Format: uuid */
                            id: string;
                            prompt: string;
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
                    excludeScene?: string;
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
                                result: string | null;
                                error: string | null;
                                messages: {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                }[];
                                actions: {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    /** @enum {string} */
                                    state: "running" | "complete" | "boundary";
                                }[];
                                recordIds: string[];
                                nextPurpose: string | null;
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
                        command: "start" | "finish" | "resume";
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
                                result: string | null;
                                error: string | null;
                                messages: {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                }[];
                                actions: {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    /** @enum {string} */
                                    state: "running" | "complete" | "boundary";
                                }[];
                                recordIds: string[];
                                nextPurpose: string | null;
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
                                } | {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    /** @enum {string} */
                                    kind: "script";
                                } | {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    /** @enum {string} */
                                    kind: "event";
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
                                } | {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    /** @enum {string} */
                                    kind: "script";
                                } | {
                                    /** Format: uuid */
                                    id: string;
                                    text: string;
                                    /** @enum {string} */
                                    kind: "event";
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
                                    /** @enum {string} */
                                    role?: "content" | "about";
                                    /** @description 関係の内容。seeではその存在に提示できる受容内容の本文 */
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
                                repository: string;
                                accessKey: string;
                                secretKey: string;
                                password: string;
                                region: string;
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
                            operation: "costs.read";
                            query: {
                                /** Format: date-time */
                                from: string;
                                /** Format: date-time */
                                to: string;
                                /** @enum {string|null} */
                                provider?: "deepseek" | "gemini" | "openai" | "anthropic" | null;
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
                                view: "summary" | "calls" | "timeline";
                                /**
                                 * @default day
                                 * @enum {string}
                                 */
                                interval?: "hour" | "day" | "month";
                                after?: string;
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
                                    provider: "deepseek" | "gemini" | "openai" | "anthropic";
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
                                    provider: "deepseek" | "gemini" | "openai" | "anthropic";
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
                            provider: "deepseek" | "gemini" | "openai" | "anthropic";
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
                            /** Format: uuid */
                            presetId: string;
                            presetVersion: number;
                        } | {
                            /** @enum {string} */
                            operation: "worlds.resumeJoin";
                            /** Format: uuid */
                            joinId: string;
                        } | {
                            /** @enum {string} */
                            operation: "worlds.configure";
                            /** Format: uuid */
                            worldId: string;
                            title: string;
                            description: string;
                            published: boolean;
                            accepting: boolean;
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
                                            presetId: string;
                                            version: number;
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
