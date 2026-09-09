import Script from "next/script";
import { METRIKA_ID, metrikaEnabled } from "@/lib/metrika";

// Счётчик Метрики. Разбор, почему он вообще здесь и почему Вебвизор выключен, — в
// `lib/metrika.ts`; следствие для человека — на `/dannye`.
//
// `afterInteractive`, а не `beforeInteractive`: счётчик не участвует в отрисовке, и
// задерживать ради него интерактивность страницы нечем оправдать. Тег вставляется штатным
// механизмом Next, а не сырым `<script>` в разметке: сырой тег в App Router выполняется на
// каждой клиентской навигации заново, и счётчик считал бы один визит несколько раз.
//
// `noscript`-пиксель не ставим: у нас PWA, без JS страница всё равно бесполезна, а канон
// проекта запрещает списывать разметку по памяти — точный вид пикселя берётся из кабинета,
// когда и если он понадобится.

export default function Metrika() {
  if (!metrikaEnabled()) return null;

  return (
    <Script id="ym-counter" strategy="afterInteractive">
      {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
ym(${METRIKA_ID}, "init", {clickmap:true, trackLinks:true, accurateTrackBounce:true, webvisor:false});`}
    </Script>
  );
}
