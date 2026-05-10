async function main() {
  const webhookUrl = process.env.TRMNL_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error("Missing TRMNL_WEBHOOK_URL");
  }

  const payload = {
  merge_variables: {
    theater: "AMC Magic Johnson Harlem 9",
    date_label: "Today",
    updated_at: "May 10, 2026, 6:30 PM",
    movies_json: JSON.stringify([
      {
        title: "Test Movie",
        rating: "PG-13",
        times: ["1:00 PM", "4:15 PM", "7:30 PM"]
      }
    ])
  }
};

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  console.log("TRMNL status:", response.status);
  console.log("TRMNL response:", text);

  if (!response.ok) {
    throw new Error(`TRMNL webhook failed: ${response.status} ${text}`);
  }

  console.log("Pushed showtimes to TRMNL");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
