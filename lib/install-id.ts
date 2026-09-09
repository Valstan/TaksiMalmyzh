// install_id: 128 случайных бит, порождается клиентом и живёт локально (M0.A §6.2.2).
//
// Общий для записи поездок и краудсигналов: одно устройство — один псевдоним, и сброс
// «забыть это устройство» будет одним действием для обоих. Только браузер: на сервере
// localStorage нет.
//
// ⚠️ Доступ к хранилищу обёрнут, потому что он бросает, а не возвращает null: в приватном
// режиме Firefox, при «блокировать данные сайтов» в Chrome и внутри некоторых встроенных
// браузеров любое обращение к localStorage — исключение. Раньше этот бросок вылетал наружу
// из `installId()` посреди `start()` в записи поездки, где его ловил общий `catch`, и
// человек получал «не удалось начать поездку» вместо правды. Запасной путь — псевдоним в
// памяти вкладки: он живёт до перезагрузки, то есть краудсигнал и карма с такого
// устройства считаются как с нового при каждом заходе. Это честнее, чем отказ работать.

const LS_INSTALL = "taksi.installId";

/** Псевдоним на время жизни вкладки — когда постоянное хранилище недоступно. */
let volatileId: string | null = null;

function newId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function installId(): string {
  try {
    const saved = localStorage.getItem(LS_INSTALL);
    if (saved) return saved;
    const id = newId();
    localStorage.setItem(LS_INSTALL, id);
    return id;
  } catch {
    // Хранилище недоступно целиком: и чтение, и запись бросают.
    volatileId ??= newId();
    return volatileId;
  }
}
