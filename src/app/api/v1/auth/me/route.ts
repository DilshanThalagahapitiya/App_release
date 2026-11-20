import { api } from "@/lib/http";
import { me } from "@/services/misc";
export const GET = api((c) => me(c.env, c.user()));
