import { sqlClient } from "./client";
import {
  addTopicTags,
  createQuestion,
  createTopic,
  createTopicEdge,
  getLocalUser
} from "@/src/server/services";

async function main() {
  const user = await getLocalUser();
  console.log(`seed user: ${user.email}`);

  await createTopic({
    slug: "topology",
    title: "Topology",
    overview: "Study of spaces, continuity, compactness, and related structure.",
    tags: ["math", "topology"]
  });
  await createTopic({
    slug: "compactness",
    title: "Compactness",
    overview: "Open-cover based finiteness property in topology.",
    tags: ["math", "topology"]
  });
  await createTopic({
    slug: "open_covers",
    title: "Open Covers",
    overview: "Families of open sets whose union contains a target space or subset.",
    tags: ["math", "topology"]
  });
  await createTopicEdge({ from_topic_id: "open_covers", to_topic_id: "compactness", edge_type: "prereq_of" });
  await addTopicTags("compactness", ["definition"]);

  await createQuestion({
    slug: "compactness_open_cover_definition",
    topic_ids: ["compactness", "open_covers"],
    question_tags: ["definition", "open-cover"],
    modality: "free_response",
    prompt: "State the definition of compactness using open covers.",
    difficulty: 0.45,
    quality_score: 0.9
  });

  console.log("seed complete");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sqlClient.end();
  });
