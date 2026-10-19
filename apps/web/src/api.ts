import createClient from "openapi-fetch";
import type { paths } from "@gestaloka/contracts/http";

export const api = createClient<paths>({ baseUrl: "/" });
