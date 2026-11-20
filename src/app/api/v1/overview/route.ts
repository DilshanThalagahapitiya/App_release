import { api } from "@/lib/http";
import { overview } from "@/services/misc";
export const GET = api((c) => overview(c.env, c.user()));
