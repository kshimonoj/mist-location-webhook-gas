/**
 * Mist Webhook — payload inspection script (multi-site).
 *
 * Purpose: capture a sample of real webhook payloads from several sites
 * to find out what fields Mist actually sends. This is NOT a production
 * receiver: location topics push events for every client continuously,
 * which will exhaust the Apps Script quota if left running.
 *
 * Site labelling: one deployment serves every site. Append &label=<name>
 * to each site's target URL, e.g.
 *   https://script.google.com/.../exec?key=SECRET&label=SiteA
 * If label is absent, SITE_LABELS is used, then the raw site_id.
 *
 * Safety guards:
 *   - MAX_ROWS: stops writing once the sheet reaches this many rows.
 *   - SHARED_KEY: requests must carry ?key=<SHARED_KEY>.
 *
 * Disable the webhooks in the Mist portal as soon as you have enough rows.
 */

const SHEET_NAME = 'MistWebhookRaw';
const MAX_ROWS = 600;           // raise this when collecting from several sites
const SHARED_KEY = 'CHANGE_ME'; // must match ?key= in each webhook target URL

// Optional fallback when a target URL has no &label=.
const SITE_LABELS = {
  // '11111111-1111-1111-1111-111111111111': 'Site A',
};

const HEADERS = [
  'Received At (JST)',
  'Site Label',
  'Topic',
  'Event Index',
  'Client Type',
  'Client ID / MAC',
  'Name',
  'Trigger',
  'Zone / vBeacon ID',
  'Site ID',
  'Map ID',
  'X',
  'Y',
  'Event Time (JST)',
  'Raw Event (JSON)'
];

function doPost(e) {
  try {
    if (SHARED_KEY && (!e.parameter || e.parameter.key !== SHARED_KEY)) {
      return json_({ status: 'unauthorized' });
    }

    const sheet = getSheet_();
    const room = MAX_ROWS - (sheet.getLastRow() - 1);
    if (room <= 0) {
      // Guard reached. Accept the POST but write nothing.
      return json_({ status: 'ok', note: 'row limit reached' });
    }

    const body = JSON.parse(e.postData.contents);
    const topic = body.topic || '';
    const events = Array.isArray(body.events) ? body.events : [body];
    const now = nowJst_();
    const urlLabel = (e.parameter && e.parameter.label) || '';

    const rows = events.map(function (ev, i) {
      const siteId = pick_(ev, ['site_id']);
      return [
        now,
        urlLabel || SITE_LABELS[siteId] || siteId,
        topic,
        i,
        pick_(ev, ['type', 'client_type']),
        pick_(ev, ['mac', 'id', 'client_id', 'wcid']),
        pick_(ev, ['name', 'device_name', 'hostname']),
        pick_(ev, ['trigger']),
        pick_(ev, ['zone_id', 'vbeacon_id']),
        siteId,
        pick_(ev, ['map_id']),
        pick_(ev, ['x']),
        pick_(ev, ['y']),
        epochToJst_(pick_(ev, ['timestamp', 'time', 'when'])),
        JSON.stringify(ev)
      ];
    });

    // Respect the guard even when one POST carries many events.
    const toWrite = rows.slice(0, room);
    if (toWrite.length > 0) {
      sheet
        .getRange(sheet.getLastRow() + 1, 1, toWrite.length, HEADERS.length)
        .setValues(toWrite);
    }

    return json_({ status: 'ok', written: toWrite.length });
  } catch (err) {
    try {
      const sheet = getSheet_();
      const row = new Array(HEADERS.length).fill('');
      row[0] = nowJst_();
      row[2] = 'ERROR';
      row[HEADERS.length - 1] = String(err);
      sheet.appendRow(row);
    } catch (ignored) {}
    return json_({ status: 'error', message: String(err) });
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function pick_(obj, keys) {
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (v !== undefined && v !== null) return v;
  }
  return '';
}

function epochToJst_(sec) {
  if (sec === '' || isNaN(sec)) return '';
  return Utilities.formatDate(new Date(Number(sec) * 1000), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
}

function nowJst_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** Per-site row counts, so you can see which sites are actually sending. */
function summarizeBySite() {
  const sheet = getSheet_();
  if (sheet.getLastRow() < 2) {
    Logger.log('no data');
    return;
  }
  const values = sheet.getRange(2, 2, sheet.getLastRow() - 1, 2).getValues(); // label, topic
  const counts = {};
  values.forEach(function (r) {
    const key = r[0] + ' / ' + r[1];
    counts[key] = (counts[key] || 0) + 1;
  });
  Object.keys(counts).sort().forEach(function (k) {
    Logger.log(k + ': ' + counts[k]);
  });
}

/** Run this manually to verify the sheet is written before enabling the webhooks. */
function testWithDummyData() {
  const dummy = {
    postData: {
      contents: JSON.stringify({
        topic: 'location-client',
        events: [
          {
            type: 'wifi',
            mac: 'aabbccddeeff',
            site_id: '00000000-0000-0000-0000-000000000000',
            map_id: '11111111-1111-1111-1111-111111111111',
            x: 12.34,
            y: 56.78,
            timestamp: 1790926176
          }
        ]
      })
    },
    parameter: { key: SHARED_KEY, label: 'TestSite' }
  };
  Logger.log(doPost(dummy).getContent());
}

/** Clear captured rows so you can take a fresh sample. */
function resetSheet() {
  const sheet = getSheet_();
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }
}
