import { NextResponse } from "next/server";
import { approveClaim, markRequest, marketReady, ownedEntries, rejectClaim, updateOwnCard, type CardPatch } from "@/lib/market";
import { addWorker, removeWorker } from "@/lib/ratings";
import {
  MAX_PHONES_PER_ENTRY,
  approveEntryEdit,
  entryEditsReady,
  rejectEntryEdit,
} from "@/lib/entry-edits";
import { commentsReady, demandByOwner, hideByStaff, restoreByStaff } from "@/lib/comments";

// Действия кабинета. Владелец: card (правка своей карточки), seen/done (вызов),
// comment_demand (требование удалить комментарий о своей карточке).
// Персонал: approve/reject (заявка на владение — после звонка по номеру),
// edit_approve/edit_reject (новый номер к существующей организации — тоже после звонка),
// comment_hide/comment_restore (комментарий на проверке).
// Право — сессия; чья именно — проверяется в lib/market.ts по owner_id, не здесь.

export const dynamic = "force-dynamic";
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return bad("Неверный запрос."); }
  if (!(await marketReady())) return bad("Кабинеты пока недоступны.", 503);

  const { getPayload } = await import("payload");
  const { default: config } = await import("@payload-config");
  const payload = await getPayload({ config });
  const { user } = await payload.auth({ headers: request.headers });
  if (!user) return bad("Нужно войти.", 401);
  const userId = Number(user.id);
  const id = typeof body.id === "number" && Number.isInteger(body.id) ? body.id : NaN;

  switch (body.action) {
    case "card": {
      if (!Number.isInteger(id)) return bad("Нужен id карточки.");
      const patch: CardPatch = {
        description: typeof body.description === "string" ? body.description : undefined,
        hours: typeof body.hours === "string" ? body.hours : undefined,
        prices: Array.isArray(body.prices)
          ? (body.prices as { label?: unknown; value?: unknown }[]).map((p) => ({
              label: typeof p?.label === "string" ? p.label : "",
              value: typeof p?.value === "string" ? p.value : "",
            }))
          : undefined,
      };
      const ok = await updateOwnCard(payload, userId, id, patch);
      return ok ? NextResponse.json({ ok: true }) : bad("Это не ваша карточка.", 403);
    }
    case "seen":
    case "done": {
      if (!Number.isInteger(id)) return bad("Нужен id вызова.");
      const ok = await markRequest(payload, userId, id, body.action);
      return ok ? NextResponse.json({ ok: true }) : bad("Вызов не найден.", 404);
    }
    case "worker_add":
    case "worker_remove": {
      if (!Number.isInteger(id)) return bad("Нужен id карточки.");
      const mine = (await ownedEntries(payload, userId)).some((e) => e.id === id);
      if (!mine) return bad("Это не ваша карточка.", 403);
      if (body.action === "worker_add") {
        const w = await addWorker(id, typeof body.name === "string" ? body.name : "");
        return w ? NextResponse.json({ ok: true, worker: w }) : bad("Имя от 2 символов, не больше 30 работников.");
      }
      const wid = typeof body.workerId === "number" ? body.workerId : NaN;
      const ok = await removeWorker(id, wid);
      return ok ? NextResponse.json({ ok: true }) : bad("Работник не найден.", 404);
    }
    case "approve":
    case "reject": {
      if (user.role !== "superadmin") return bad("Только персонал.", 403);
      if (!Number.isInteger(id)) return bad("Нужен id заявки.");
      const ok = body.action === "approve" ? await approveClaim(payload, id) : await rejectClaim(id);
      return ok ? NextResponse.json({ ok: true }) : bad("Заявка не найдена.", 404);
    }
    case "edit_approve":
    case "edit_reject": {
      if (user.role !== "superadmin") return bad("Только персонал.", 403);
      if (!Number.isInteger(id)) return bad("Нужен id правки.");
      if (!(await entryEditsReady())) return bad("Очередь правок пока недоступна.", 503);
      if (body.action === "edit_reject") {
        return (await rejectEntryEdit(id))
          ? NextResponse.json({ ok: true, result: "rejected" })
          : bad("Правка не найдена.", 404);
      }
      const r = await approveEntryEdit(payload, id);
      if (r === "not_found") return bad("Правка не найдена.", 404);
      if (r === "full") {
        return bad(`У карточки уже ${MAX_PHONES_PER_ENTRY} номеров — поправьте её в админке.`, 409);
      }
      return NextResponse.json({ ok: true, result: r });
    }
    case "comment_hide":
    case "comment_restore": {
      if (user.role !== "superadmin") return bad("Только персонал.", 403);
      if (!Number.isInteger(id)) return bad("Нужен id комментария.");
      if (!(await commentsReady())) return bad("Комментарии пока недоступны.", 503);
      const ok = body.action === "comment_hide" ? await hideByStaff(id) : await restoreByStaff(id);
      return ok ? NextResponse.json({ ok: true }) : bad("Комментарий не найден.", 404);
    }
    case "comment_demand": {
      // Требование — владельцу карточки, и только о своей: сверка по owner_id, как у
      // остальных действий владельца. Исход возвращается всегда, а не молчаливое ok.
      if (!Number.isInteger(id)) return bad("Нужен id комментария.");
      if (!(await commentsReady())) return bad("Комментарии пока недоступны.", 503);
      const mine = (await ownedEntries(payload, userId)).map((e) => e.id);
      if (mine.length === 0) return bad("У вас нет карточек.", 403);
      const r = await demandByOwner(mine, id);
      return r === "not_found"
        ? bad("Это не комментарий о вашей карточке.", 404)
        : NextResponse.json({ ok: true, result: r });
    }
    default:
      return bad("Неизвестное действие.");
  }
}
