export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6">
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-bold text-gray-900">
          Финансы
        </h1>

        <p className="mt-1 text-sm text-gray-500">
          Учет доходов и расходов
        </p>

        <button className="mt-6 w-full rounded-2xl bg-black px-4 py-4 text-lg font-semibold text-white">
          + Добавить операцию
        </button>

        <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-gray-900">
            Последние операции
          </h2>

          <p className="mt-4 text-sm text-gray-500">
            Пока операций нет
          </p>
        </div>
      </div>
    </main>
  );
}