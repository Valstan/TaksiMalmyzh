// install_id: 128 случайных бит, порождается клиентом и живёт локально (M0.A §6.2.2).
//
// Общий для записи поездок и краудсигналов: одно устройство — один псевдоним, и сброс
// «забыть это устройство» будет одним действием для обоих. Только браузер: на сервере
// localStorage нет.

const LS_INSTALL = "taksi.installId";

export function installId(): string {
  let id = localStorage.getItem(LS_INSTALL);
  if (!id) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    id = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(LS_INSTALL, id);
  }
  return id;
}
