/**
 * 5A.5 — Storage Migration Script
 *
 * Режимы запуска:
 *   node migrate_storage.mjs          → DRY RUN (только показывает план, ничего не меняет)
 *   node migrate_storage.mjs --apply  → выполняет миграцию
 *
 * Что делает (при --apply):
 *   1. Копирует файлы из promo_slides/ (корень)   → promo_slides/jcl/{file}
 *   2. Копирует файлы из "promo transition"/ (корень) → promo-transition/jcl/{file}
 *   3. Создаёт placeholder promo_slides/boxing-test/.keep (только для sponsors bucket)
 *   4. Добавляет записи в таблицы sponsors и promo_media (ON CONFLICT DO NOTHING)
 *
 * Что НЕ делает:
 *   - НЕ удаляет старые файлы
 *   - НЕ меняет app.js
 *   - НЕ включает RLS
 *   - НЕ трогает promo_settings
 *
 * Предварительно создать bucket вручную в Supabase Dashboard:
 *   Имя: promo-transition  (Public: Yes)
 */

// ─── КОНФИГУРАЦИЯ ─────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://whorwleydkziejjafsea.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Iz2KPXd8D7bWIhyzOvObeg_GrLRVJma';

const BUCKET_SPONSORS     = 'promo_slides';      // существующий bucket спонсоров
const BUCKET_PROMO_OLD    = 'promo transition';  // существующий bucket promo (с пробелом)
const BUCKET_PROMO_NEW    = 'promo-transition';  // новый bucket promo (с дефисом)

const CLUB_JCL = 'jcl';
const CLUB_BCT = 'boxing-test';

const DRY_RUN = !process.argv.includes('--apply');

// ─── ВЫВОД ────────────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
};

function log(msg)    { console.log(`  ${c.green}✅${c.reset} ${msg}`); }
function info(msg)   { console.log(`  ${c.cyan}→${c.reset}  ${msg}`); }
function warn(msg)   { console.warn(`  ${c.yellow}⚠️${c.reset}  ${msg}`); }
function skip(msg)   { console.log(`  ${c.dim}⏭  ${msg}${c.reset}`); }
function errlog(msg) { console.error(`  ${c.red}❌${c.reset} ${msg}`); }
function section(t)  { console.log(`\n${c.bold}── ${t}${c.reset}`); }

// ─── SUPABASE STORAGE API ─────────────────────────────────────────────────────
const baseHeaders = {
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'apikey': SUPABASE_KEY,
  'Content-Type': 'application/json',
};

/** Получить список файлов в папке bucket (возвращает только файлы, не папки) */
async function listFiles(bucket, prefix = '') {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/list/${encodeURIComponent(bucket)}`,
    {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({ prefix, limit: 200, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`list("${bucket}", "${prefix}") → ${res.status}: ${text}`);
  }

  const data = await res.json();
  // Папки не имеют metadata или имеют metadata.size === 0
  return (data || []).filter(f =>
    f.name &&
    f.metadata &&
    typeof f.metadata.size === 'number' &&
    f.metadata.size >= 0 &&
    !f.name.startsWith('.')   // скрытые файлы пропускаем при листинге
  );
}

/** Копировать файл внутри одного bucket (без скачивания) */
async function copyWithinBucket(bucket, srcKey, dstKey) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/copy`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      bucketId: bucket,
      sourceKey: srcKey,
      destinationKey: dstKey,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`copy("${srcKey}" → "${dstKey}") → ${res.status}: ${text}`);
  }
}

/** Скачать файл из публичного bucket */
async function downloadFile(bucket, filePath) {
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPath   = filePath.split('/').map(encodeURIComponent).join('/');
  const url = `${SUPABASE_URL}/storage/v1/object/public/${encodedBucket}/${encodedPath}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`download("${bucket}/${filePath}") → ${res.status}`);

  return res.arrayBuffer();
}

/** Загрузить файл в bucket (upsert — не падает если файл уже существует) */
async function uploadFile(bucket, destPath, buffer, contentType = 'application/octet-stream') {
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPath   = destPath.split('/').map(encodeURIComponent).join('/');

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${encodedBucket}/${encodedPath}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: buffer,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`upload("${bucket}/${destPath}") → ${res.status}: ${text}`);
  }
}

// ─── SUPABASE DB API ──────────────────────────────────────────────────────────
async function dbUpsert(table, rows) {
  if (rows.length === 0) return;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      ...baseHeaders,
      'Prefer': 'resolution=ignore-duplicates',
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`INSERT INTO "${table}" → ${res.status}: ${text}`);
  }
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function guessContentType(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const map = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png',  gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml',
    mp4: 'video/mp4',  txt: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {

  console.log('\n' + '═'.repeat(60));
  console.log(`  ${c.bold}5A.5 Storage Migration${c.reset}  ${DRY_RUN ? c.yellow + '[DRY RUN — ничего не изменится]' + c.reset : c.green + '[APPLY MODE]' + c.reset}`);
  console.log('═'.repeat(60));

  if (DRY_RUN) {
    console.log(`\n  ${c.yellow}Это предварительный просмотр. Для запуска миграции:`);
    console.log(`  node migrate_storage.mjs --apply${c.reset}\n`);
  }

  // ────────────────────────────────────────────────────────────
  // ЧАСТЬ 1: promo_slides (корень) → promo_slides/jcl/
  // ────────────────────────────────────────────────────────────
  section('ЧАСТЬ 1 — Спонсоры: promo_slides/ → promo_slides/jcl/');

  let sponsorFiles = [];
  try {
    const all = await listFiles(BUCKET_SPONSORS, '');
    // Только файлы в корне (не в папках jcl/ или boxing-test/)
    sponsorFiles = all.filter(f => !f.name.includes('/'));
    console.log(`\n   Найдено файлов в корне "${BUCKET_SPONSORS}": ${sponsorFiles.length}\n`);
  } catch (e) {
    errlog(`Не удалось получить список: ${e.message}`);
  }

  const sponsorDbRows = [];

  for (let idx = 0; idx < sponsorFiles.length; idx++) {
    const file     = sponsorFiles[idx];
    const srcPath  = file.name;
    const dstPath  = `${CLUB_JCL}/${file.name}`;
    const size     = formatBytes(file.metadata?.size || 0);

    console.log(`   ${c.cyan}${file.name}${c.reset}  (${size})`);
    console.log(`     ${c.dim}promo_slides/${srcPath}${c.reset}`);
    console.log(`     ${c.green}→ promo_slides/${dstPath}${c.reset}`);

    if (!DRY_RUN) {
      try {
        await copyWithinBucket(BUCKET_SPONSORS, srcPath, dstPath);
        log(`Скопировано`);
      } catch (e) {
        warn(`Copy failed: ${e.message}`);
        continue;  // не добавлять в DB если копирование не удалось
      }
    }

    sponsorDbRows.push({
      club_id:    CLUB_JCL,
      file_name:  file.name,
      file_path:  dstPath,
      aktiv:      true,
      sort_order: idx + 1,
    });
  }

  // placeholder boxing-test
  console.log(`\n   ${c.cyan}boxing-test/.keep${c.reset}  (placeholder)`);
  console.log(`     ${c.green}→ promo_slides/${CLUB_BCT}/.keep${c.reset}`);
  if (!DRY_RUN) {
    try {
      const keepBuf = new TextEncoder().encode('');
      await uploadFile(BUCKET_SPONSORS, `${CLUB_BCT}/.keep`, keepBuf, 'text/plain');
      log('Placeholder создан');
    } catch (e) {
      warn(`Placeholder: ${e.message}`);
    }
  }

  // INSERT sponsors
  if (!DRY_RUN && sponsorDbRows.length > 0) {
    try {
      await dbUpsert('sponsors', sponsorDbRows);
      log(`Добавлено ${sponsorDbRows.length} записей → таблица sponsors`);
    } catch (e) {
      errlog(`DB insert sponsors: ${e.message}`);
    }
  } else if (DRY_RUN && sponsorDbRows.length > 0) {
    console.log(`\n   ${c.dim}[DRY RUN] INSERT INTO sponsors:${c.reset}`);
    sponsorDbRows.forEach(r =>
      console.log(`   ${c.dim}  { club_id: '${r.club_id}', file_name: '${r.file_name}', file_path: '${r.file_path}', aktiv: ${r.aktiv} }${c.reset}`)
    );
  }

  // ────────────────────────────────────────────────────────────
  // ЧАСТЬ 2: "promo transition"/ → promo-transition/jcl/
  // ────────────────────────────────────────────────────────────
  section(`ЧАСТЬ 2 — Promo: "promo transition"/ → promo-transition/jcl/`);

  let promoFiles = [];
  try {
    const all = await listFiles(BUCKET_PROMO_OLD, '');
    promoFiles = all.filter(f => !f.name.includes('/'));
    console.log(`\n   Найдено файлов в корне "promo transition": ${promoFiles.length}\n`);
  } catch (e) {
    errlog(`Не удалось получить список: ${e.message}`);
  }

  const promoDbRows = [];

  for (let idx = 0; idx < promoFiles.length; idx++) {
    const file    = promoFiles[idx];
    const srcPath = file.name;
    const dstPath = `${CLUB_JCL}/${file.name}`;
    const size    = formatBytes(file.metadata?.size || 0);
    const ct      = guessContentType(file.name);

    console.log(`   ${c.cyan}${file.name}${c.reset}  (${size})`);
    console.log(`     ${c.dim}"promo transition"/${srcPath}${c.reset}`);
    console.log(`     ${c.green}→ promo-transition/${dstPath}${c.reset}`);

    if (!DRY_RUN) {
      try {
        // Межбакетное копирование: download → upload
        const buffer = await downloadFile(BUCKET_PROMO_OLD, srcPath);
        await uploadFile(BUCKET_PROMO_NEW, dstPath, buffer, ct);
        log(`Перенесено`);
      } catch (e) {
        warn(`Transfer failed: ${e.message}`);
        continue;
      }
    }

    promoDbRows.push({
      club_id:    CLUB_JCL,
      file_name:  file.name,
      file_path:  dstPath,
      aktiv:      true,
      sort_order: idx + 1,
    });
  }

  // INSERT promo_media
  if (!DRY_RUN && promoDbRows.length > 0) {
    try {
      await dbUpsert('promo_media', promoDbRows);
      log(`Добавлено ${promoDbRows.length} записей → таблица promo_media`);
    } catch (e) {
      errlog(`DB insert promo_media: ${e.message}`);
    }
  } else if (DRY_RUN && promoDbRows.length > 0) {
    console.log(`\n   ${c.dim}[DRY RUN] INSERT INTO promo_media:${c.reset}`);
    promoDbRows.forEach(r =>
      console.log(`   ${c.dim}  { club_id: '${r.club_id}', file_name: '${r.file_name}', file_path: '${r.file_path}', aktiv: ${r.aktiv} }${c.reset}`)
    );
  }

  // ────────────────────────────────────────────────────────────
  // ИТОГ
  // ────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${c.bold}ИТОГ${c.reset}`);
  console.log('═'.repeat(60));

  if (DRY_RUN) {
    console.log(`\n  ${c.yellow}[DRY RUN] Ничего не было изменено.${c.reset}`);
    console.log(`\n  Для запуска миграции:`);
    console.log(`  ${c.cyan}node migrate_storage.mjs --apply${c.reset}\n`);
  } else {
    console.log(`\n  sponsors записей:    ${sponsorDbRows.length}`);
    console.log(`  promo_media записей: ${promoDbRows.length}`);
    console.log(`\n  ${c.yellow}Старые файлы НЕ удалены.${c.reset}`);
    console.log(`\n  Проверочный SQL (выполнить в Supabase SQL Editor):\n`);
    console.log(`  SELECT 'sponsors'   , count(*) FROM sponsors    WHERE club_id = 'jcl'`);
    console.log(`  UNION ALL`);
    console.log(`  SELECT 'promo_media', count(*) FROM promo_media WHERE club_id = 'jcl';`);
  }

  console.log('\n' + '═'.repeat(60) + '\n');
}

main().catch(e => {
  console.error(`\n${c.red}FATAL:${c.reset}`, e.message);
  process.exit(1);
});
