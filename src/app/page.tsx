export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold">Plan PR</h1>
      <p className="max-w-md text-sm text-zinc-500">
        Adviser co-pilot: every client plan is a pull request — facts in, gates
        run, adviser approves. UI lands in phase 50; try{" "}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
          /api/health
        </code>
        .
      </p>
    </main>
  );
}
