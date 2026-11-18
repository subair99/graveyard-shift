import { HomeView } from "../ui/components/HomeView";
import { loadSite } from "../ui/shell/loadSite";

export default async function HomePage() {
  await loadSite();
  return <HomeView />;
}
