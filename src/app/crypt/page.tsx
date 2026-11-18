import { CryptIndexView } from "../../ui/components/CryptIndexView";
import { loadSite } from "../../ui/shell/loadSite";

export default async function CryptPage() {
  const view = await loadSite();
  return <CryptIndexView view={view} />;
}
