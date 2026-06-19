import { redirect } from "next/navigation";
import { DEFAULT_UNIVERSE } from "@/lib/universes";

export default function RootPage() {
  redirect(`/u/${DEFAULT_UNIVERSE}`);
}
