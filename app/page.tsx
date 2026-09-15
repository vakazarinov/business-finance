import { supabase } from "@/lib/supabase";

export default async function Home() {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .order("date", { ascending: false });

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold">
          Ошибка
        </h1>

        <pre className="mt-4 whitespace-pre-wrap">
          {error.message}
        </pre>
      </main>
    );
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">
        Финансы
      </h1>

      <pre className="mt-6">
        {JSON.stringify(data, null, 2)}
      </pre>
    </main>
  );
}