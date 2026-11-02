// Google Apps Script backend for the Helett QC Checklist App.
// Deploy as a Web App (Execute as: Me, Who has access: Anyone with the link).
// Mirrors the contract in src/services/api.ts. All requests are POST with a
// JSON string body (Content-Type: text/plain) — see api.ts for why.
//
// Sheet setup: a single sheet named "Inspections" with header row matching
// the FIELDS array below, in the same order.

var SHEET_NAME = 'Inspections'

// Column Q used to be 'fullPhoto' (an unused Y/N placeholder tied to the old
// disabled "Upload Photo" button). It's been repointed to 'scannedCode' —
// same column, same position in this array, just holding the QR/barcode
// scanner's decoded text now instead. No new column needed.
var FIELDS = [
  'id', 'timestamp', 'inspectionDate', 'shipmentId', 'productName', 'sku',
  'receivedQty', 'qcQty', 'acceptedQty', 'rejectedQty', 'modelDispatched',
  'productCondition', 'packagingQuality', 'labelBarcode', 'accessoriesIncluded',
  'properSealing', 'scannedCode', 'fnskuPresent', 'mrpPresent',
  'serialNumberPresent', 'shippingLabelPresent', 'fullRemarks', 'overallResult',
  'qcRemarks', 'inspectorName', 'qcSignatureUrl', 'dispatchConfirmedBy',
  'dispatchDate', 'dispatchSignUrl', 'finalConfirmationBy', 'signatureUrl',
  'status', 'updatedAt'
]

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet()
  var sheet = ss.getSheetByName(SHEET_NAME)
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME)
    sheet.appendRow(FIELDS)
  }
  return sheet
}

// inspectionDate and dispatchDate are meant to be plain calendar dates
// ("2026-07-23"), shown in the sheet as a readable Date-formatted cell
// ("Jul 23, 2026") — that display is intentional, so we don't fight it by
// forcing the column to Plain Text. Instead we remove all ambiguity from the
// write itself: rather than writing a raw string and letting Sheets guess
// how to parse it (which depends on spreadsheet locale and can misfire),
// parseDateOnly_ builds an explicit Date object at local midnight for the
// exact intended calendar day. Sheets stores exactly that value and displays
// it with the column's existing Date format. On read, formatDateOnly_
// converts it back to a "yyyy-MM-dd" string using the same timezone
// (Session.getScriptTimeZone(), which matches the spreadsheet's timezone),
// so the round trip is exact with no drift. It also self-heals any leftover
// rows from an earlier, buggier version of this file that could corrupt the
// value with a stray leading character.
var DATE_ONLY_FIELDS = ['inspectionDate', 'dispatchDate']

function formatDateOnly_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd')
  }
  if (typeof value === 'string') {
    var match = value.match(/(\d{4}-\d{2}-\d{2})/)
    return match ? match[1] : value
  }
  return value
}

function parseDateOnly_(value) {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    var match = value.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }
  return value
}

function rowToInspection_(row) {
  var obj = {}
  for (var i = 0; i < FIELDS.length; i++) {
    var field = FIELDS[i]
    var value = row[i] === undefined ? '' : row[i]
    if (DATE_ONLY_FIELDS.indexOf(field) !== -1) {
      value = formatDateOnly_(value)
    }
    if (SIGNATURE_FIELDS.indexOf(field) !== -1) {
      value = normalizeSignatureUrl_(value)
    }
    obj[field] = value
  }
  return obj
}

function inspectionToRow_(insp) {
  return FIELDS.map(function (f) {
    var v = insp[f] !== undefined ? insp[f] : ''
    if (DATE_ONLY_FIELDS.indexOf(f) !== -1 && v) {
      return parseDateOnly_(v)
    }
    return v
  })
}

// Looks up a row by id reading ONLY column A, not the full width of every
// row (33 columns) like a naive getDataRange().getValues() scan would. Same
// linear scan, but ~33x less data transferred/processed per call — this
// runs on every 'get' and 'update', and per this app's real workflow a
// single inspection gets updated 3+ times (Inventory creates it, QC signs
// it, the manager gives final confirmation), so the saving comes back to
// this lookup repeatedly across a record's lifetime.
function findRowIndexById_(sheet, id) {
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return -1
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues()
  for (var r = 0; r < ids.length; r++) {
    if (ids[r][0] === id) return r + 2 // 1-indexed sheet row
  }
  return -1
}

var SIGNATURE_FIELDS = ['qcSignatureUrl', 'dispatchSignUrl', 'signatureUrl']
var DRIVE_FOLDER_NAME = 'Helett QC Signatures'

function getSignatureFolder_() {
  var folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME)
  if (folders.hasNext()) return folders.next()
  return DriveApp.createFolder(DRIVE_FOLDER_NAME)
}

// file.getUrl() returns Drive's HTML *viewer page* ("/file/d/ID/view"), not
// raw image bytes, so it never worked as an <img> source. Its replacement,
// the "thumbnail" hotlink endpoint, IS a real image URL — but Google's
// public hotlink endpoints (thumbnail?id=, uc?export=view) are known to
// intermittently 403 or rate-limit anonymous cross-origin <img> requests,
// which made saved signatures still show blank sometimes even with a
// correct URL in the data.
//
// The reliable fix: never ask the browser to load a Drive URL directly.
// inlineDriveSignature_ fetches the actual image bytes SERVER-SIDE (Code.gs
// has full authorized Drive access, so it isn't subject to the anonymous
// hotlink restrictions) and embeds them as a base64 data URL right in the
// JSON response. SignaturePad already natively supports base64 data URLs —
// it's the exact format it produces before upload — so no frontend change
// is needed. The Drive file/link is still kept and stored in the sheet so
// admins can open it directly from Google Sheets.
function embeddableDriveImageUrl_(fileId) {
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000'
}

function driveFileIdFromUrl_(value) {
  if (typeof value !== 'string') return null
  var match = value.match(/id=([^&]+)/) || value.match(/\/file\/d\/([^/]+)\//)
  return match ? match[1] : null
}

// Self-heals rows saved by an earlier, buggy version of this file that
// stored the non-embeddable viewer URL instead.
function normalizeSignatureUrl_(value) {
  var fileId = driveFileIdFromUrl_(value)
  return fileId ? embeddableDriveImageUrl_(fileId) : value
}

// Converts a stored Drive signature reference into a base64 data URL by
// reading the actual file bytes. Falls back to the original value (rather
// than failing the whole request) if the file can't be read, e.g. deleted.
function inlineDriveSignature_(value) {
  var fileId = driveFileIdFromUrl_(value)
  if (!fileId) return value
  try {
    var blob = DriveApp.getFileById(fileId).getBlob()
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes())
  } catch (err) {
    return value
  }
}

// Applied right before a single inspection (get/create/update) goes out as
// JSON, so the app always receives ready-to-render image data instead of a
// link it has to fetch separately. Not applied to 'list' — Dashboard cards
// don't show signatures, so inlining base64 into every record there would
// only bloat that payload for no benefit.
function inlineAllSignatures_(insp) {
  SIGNATURE_FIELDS.forEach(function (field) {
    insp[field] = inlineDriveSignature_(insp[field])
  })
  return insp
}

// The frontend always resubmits every field on save, including signature
// fields it only ever received back from us as inlined base64 (see
// inlineAllSignatures_ above). Without this check, resaving a record the
// user never actually re-signed would look identical to a brand new
// signature — both are base64 data URLs — and persistSignatures_ would
// re-upload and duplicate the same image to Drive on every single save.
// Comparing the incoming base64 against the existing file's own decoded
// bytes tells a real edit apart from an unchanged resubmission.
function discardUnchangedSignatures_(updated, existing) {
  SIGNATURE_FIELDS.forEach(function (field) {
    var incoming = updated[field]
    if (typeof incoming === 'string' && incoming.indexOf('data:image') === 0) {
      if (incoming === inlineDriveSignature_(existing[field])) {
        updated[field] = existing[field] // unchanged — keep the original Drive reference
      }
    }
  })
  return updated
}

// If a signature field holds a base64 PNG data URL (from SignaturePad's
// toDataURL()), decode it and store it as a file in Drive, replacing the
// field with a Drive reference. Leaves already-uploaded URLs untouched
// (aside from normalizing legacy viewer-page URLs, see above).
function persistSignatures_(insp) {
  var folder = null
  SIGNATURE_FIELDS.forEach(function (field) {
    var value = insp[field]
    if (typeof value === 'string' && value.indexOf('data:image') === 0) {
      if (!folder) folder = getSignatureFolder_()
      var base64 = value.split(',')[1]
      var blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', insp.id + '-' + field + '.png')
      var file = folder.createFile(blob)
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)
      insp[field] = embeddableDriveImageUrl_(file.getId())
    } else {
      insp[field] = normalizeSignatureUrl_(value)
    }
  })
  return insp
}

// doPost can't be tested with the ▶ Run button in this editor — there's no
// real HTTP request for Apps Script to hand it, so `e` comes back undefined.
// To actually test it: Deploy → Manage deployments → copy the Web App URL,
// then send it a real POST, e.g. from a terminal:
//   curl -X POST "<your web app URL>" -H "Content-Type: text/plain" -d "{\"action\":\"list\"}"
// Or just use the running app (with VITE_API_URL pointed at that URL) and
// watch it work from the Dashboard/QC form.
function doPost(e) {
  if (!e || !e.postData) {
    return jsonResponse_({ error: 'No POST data received. Run this via the deployed Web App URL, not the editor Run button.' }, 400)
  }
  var body = JSON.parse(e.postData.contents)
  var action = body.action
  var sheet = getSheet_()
  var result

  if (action === 'list') {
    var data = sheet.getDataRange().getValues()
    var rows = data.slice(1).map(rowToInspection_)
    result = rows
  } else if (action === 'get') {
    var rowIdx = findRowIndexById_(sheet, body.id)
    if (rowIdx === -1) {
      return jsonResponse_({ error: 'Inspection not found' }, 404)
    }
    var row = sheet.getRange(rowIdx, 1, 1, FIELDS.length).getValues()[0]
    result = inlineAllSignatures_(rowToInspection_(row))
  } else if (action === 'create') {
    var now = new Date().toISOString()
    var insp = Object.assign({}, body)
    delete insp.action
    insp.id = Utilities.getUuid()
    insp.timestamp = now
    insp.updatedAt = now
    insp = persistSignatures_(insp)
    sheet.appendRow(inspectionToRow_(insp)) // writes the Drive reference, not inlined base64
    result = inlineAllSignatures_(insp)
  } else if (action === 'update') {
    var updateRowIdx = findRowIndexById_(sheet, body.id)
    if (updateRowIdx === -1) {
      return jsonResponse_({ error: 'Inspection not found' }, 404)
    }
    var existingRow = sheet.getRange(updateRowIdx, 1, 1, FIELDS.length).getValues()[0]
    var existing = rowToInspection_(existingRow)
    var updated = Object.assign({}, existing, body)
    delete updated.action
    updated.updatedAt = new Date().toISOString()
    updated = discardUnchangedSignatures_(updated, existing)
    updated = persistSignatures_(updated)
    sheet.getRange(updateRowIdx, 1, 1, FIELDS.length).setValues([inspectionToRow_(updated)]) // Drive reference, not inlined base64
    result = inlineAllSignatures_(updated)
  } else {
    return jsonResponse_({ error: 'Unknown action: ' + action }, 400)
  }

  return jsonResponse_(result, 200)
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  )
}
