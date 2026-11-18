import { notFound } from "next/navigation";
import { EmptyCryptView } from "../../../ui/components/EmptyCryptView";
import { EntryView } from "../../../ui/components/EntryView";
import { EMPTY_CRYPT_PARAM } from "../../../ui/core/site";
import { staticParamsFor } from "../../../ui/core/staticParams";
import { loadSite } from "../../../ui/shell/loadSite";

export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ name: string }[]> {
  return staticParamsFor(await loadSite());
}

export default async function EntryPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const view = await loadSite();
  if (name === EMPTY_CRYPT_PARAM && view.entries.length === 0) return <EmptyCryptView />;
  const entry = view.entries.find((e) => e.name === name);
  if (entry === undefined) notFound();
  return <EntryView entry={entry} nightlyRun={view.nightlyRun} />;
}
