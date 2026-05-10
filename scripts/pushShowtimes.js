async function main() {
  const webhookUrl = process.env.TRMNL_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error("Missing TRMNL_WEBHOOK_URL");
  }

  const payload = {
    merge_variables: {
      theater: "AMC Magic Johnson Harlem 9",
      date_label: "Today",
      updated_at: new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
      }),
      movies: [
        {
          title: "Test Movie",
          rating: "PG-13",
          times: ["1:00 PM", "4:15 PM", "7:30 PM"],
        },
        {
          title: "Another Test Movie",
          rating: "R",
          times: ["2:20 PM", "6:00 PM", "9:10 PM"],
        },
      ],
    },
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`TRMNL webhook failed: ${response.status} ${text}`);
  }

  console.log("Pushed showtimes to TRMNL");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
