import { useState } from 'react';
import toast from 'react-hot-toast';

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_SHEETS_CLIENT_ID;

if (!CLIENT_ID) {
  console.error("Missing Google Client ID. Check your .env file.");
}

export interface SheetData {
  title: string;
  rows: string[][];
}

export function useGoogleSheets() {
  const [isExporting, setIsExporting] = useState(false);

  // --- Helper: Create Workbook & Apply Styling ---
  const createWorkbook = async (accessToken: string, filename: string, sheetsData: SheetData[]) => {
    
    // 1. Define the Pink Color (Matches #e6b8af)
    const pinkColor = { red: 0.9, green: 0.72, blue: 0.69 };

    // 2. Prepare Sheet Configuration (Tabs)
    const sheetsConfig = sheetsData.map(s => ({
      properties: { title: s.title }
    }));

    // 3. Create the Spreadsheet with all Tabs
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: { title: filename },
        sheets: sheetsConfig
      }),
    });

    if (!createRes.ok) throw new Error('Failed to create spreadsheet');
    const spreadsheetData = await createRes.json();
    const spreadsheetId = spreadsheetData.spreadsheetId;
    
    // 4. Map Titles to Sheet IDs (Google assigns random IDs, we need to track them)
    const sheetIdsMap = spreadsheetData.sheets.reduce((acc: any, s: any) => {
      acc[s.properties.title] = s.properties.sheetId;
      return acc;
    }, {});

    // 5. Prepare Data Payload (Bulk Upload)
    const dataPayload = sheetsData.map(sheet => ({
      range: `${sheet.title}!A1`, 
      values: sheet.rows
    }));

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: dataPayload
      }),
    });

    // 6. Prepare Formatting Payload (Bulk Styling)
    const requests: any[] = [];

    sheetsData.forEach(sheet => {
      const sheetId = sheetIdsMap[sheet.title];
      const rowCount = sheet.rows.length;
      const colCount = sheet.rows[0].length;

      requests.push(
        // A. Global Cell Style (Borders, Center, Wrap)
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: colCount },
            cell: {
              userEnteredFormat: {
                wrapStrategy: "WRAP", verticalAlignment: "MIDDLE", horizontalAlignment: "CENTER",
                borders: { top: { style: "SOLID" }, bottom: { style: "SOLID" }, left: { style: "SOLID" }, right: { style: "SOLID" } }
              }
            },
            fields: "userEnteredFormat(wrapStrategy,verticalAlignment,horizontalAlignment,borders)"
          }
        },
        // B. Header Row Style (Pink & Bold)
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: colCount },
            cell: { userEnteredFormat: { backgroundColor: pinkColor, horizontalAlignment: "CENTER", textFormat: { bold: true, fontSize: 11 } } },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
          }
        },
        // C. First Column Style (Pink & Bold)
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 1 },
            cell: { userEnteredFormat: { backgroundColor: pinkColor, horizontalAlignment: "CENTER", textFormat: { bold: true } } },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
          }
        },
        // D. Auto-Resize Columns
        { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: colCount } } },
        // E. Freeze Header & First Column
        { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } }, fields: "gridProperties(frozenRowCount,frozenColumnCount)" } }
      );
    });

    // 7. Execute Formatting
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    return spreadsheetData.spreadsheetUrl;
  };

  // --- Main Trigger Function ---
  const exportToWorkbook = (filename: string, sheetsData: SheetData[]) => {
    setIsExporting(true);
    const toastId = toast.loading('Waiting for Google Sign-in...');

    // @ts-ignore
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: async (tokenResponse: any) => {
        if (tokenResponse.access_token) {
          try {
            toast.loading(`Creating ${sheetsData.length} sheets...`, { id: toastId });
            const url = await createWorkbook(tokenResponse.access_token, filename, sheetsData);
            
            toast.success('Workbook created!', { id: toastId });
            window.open(url, '_blank');
          } catch (err) {
            console.error('Export failed:', err);
            toast.error('Failed to create sheet.', { id: toastId });
          } finally {
            setIsExporting(false);
          }
        } else {
            toast.dismiss(toastId);
            setIsExporting(false);
        }
      },
    });

    client.requestAccessToken();
  };

  return { exportToWorkbook, isExporting };
}