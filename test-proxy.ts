import { parseProxyResponse } from "./src/lib/hooks/useTmdbStory.ts";
async function main() {
  const data = await fetch("https://meta.1proxy.workers.dev/?url=tt11198330").then(r => r.json());
  const story = parseProxyResponse(data);
  console.log("Featured review:", JSON.stringify(story.featuredReview, null, 2));
}
main();
