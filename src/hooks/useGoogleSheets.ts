import { useState } from 'react';
import toast from 'react-hot-toast';

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_SHEETS_CLIENT_ID;

if (!CLIENT_ID) {
  console.error("Missing Google Client ID in .env file");
}

export function useGoogleSheets() {
  const [isExporting, setIsExporting] = useState(false);

  // --- Helper: Apply Formatting ---
  const formatSheet = async (accessToken: string, spreadsheetId: string, rowCount: number, colCount: number) => {
    // Define the Pink Color (Matches #e6b8af)
    const pinkColor = { red: 0.9, green: 0.72, blue: 0.69 };

    const requests = [
      // 1. GLOBAL STYLE: Borders, Wrapping, Alignment (Applies to EVERYTHING)
      {
        repeatCell: {
          range: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: rowCount,   // Stops exactly at the last row
            startColumnIndex: 0,
            endColumnIndex: colCount // Stops exactly at the last column
          },
          cell: {
            userEnteredFormat: {
              wrapStrategy: "WRAP",
              verticalAlignment: "MIDDLE",
              horizontalAlignment: "CENTER",
              borders: {
                top: { style: "SOLID" },
                bottom: { style: "SOLID" },
                left: { style: "SOLID" },
                right: { style: "SOLID" }
              }
            }
          },
          fields: "userEnteredFormat(wrapStrategy,verticalAlignment,horizontalAlignment,borders)"
        }
      },
      // 2. HEADER ROW STYLE: Pink Background + Bold
      {
        repeatCell: {
          range: {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 1, // First row only
            startColumnIndex: 0,
            endColumnIndex: colCount
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: pinkColor,
              horizontalAlignment: "CENTER",
              textFormat: { bold: true, fontSize: 11 }
            }
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
        }
      },
      // 3. FIRST COLUMN (DAYS) STYLE: Pink Background + Bold
      {
        repeatCell: {
          range: {
            sheetId: 0,
            startRowIndex: 1, // Skip header (already colored)
            endRowIndex: rowCount,
            startColumnIndex: 0,
            endColumnIndex: 1 // First column only
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: pinkColor,
              horizontalAlignment: "CENTER",
              textFormat: { bold: true }
            }
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
        }
      },
      // 4. Auto-Resize Columns
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId: 0,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: colCount
          }
        }
      },
      // 5. Freeze Header Row and First Column
      {
        updateSheetProperties: {
          properties: {
            sheetId: 0,
            gridProperties: {
              frozenRowCount: 1,
              frozenColumnCount: 1
            }
          },
          fields: "gridProperties(frozenRowCount,frozenColumnCount)"
        }
      }
    ];

    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    });
  };

  // --- Main Logic (Identical to before) ---
  const createSheet = async (accessToken: string, title: string, rows: string[][]) => {
    // A. Create Sheet
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title } }),
    });

    if (!createRes.ok) throw new Error('Failed to create sheet');
    const sheetData = await createRes.json();
    const spreadsheetId = sheetData.spreadsheetId;

    // B. Add Data
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    });

    // C. Apply New Formatting
    const rowCount = rows.length;
    const colCount = rows[0].length;
    await formatSheet(accessToken, spreadsheetId, rowCount, colCount);

    return sheetData.spreadsheetUrl;
  };

  // --- Trigger Function ---
  const exportToSheets = (filename: string, dataRows: string[][]) => {
    setIsExporting(true);
    const toastId = toast.loading('Waiting for Google Sign-in...');
    // @ts-ignore
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: async (tokenResponse: any) => {
        if (tokenResponse.access_token) {
          try {
            toast.loading('Formatting & creating sheet...', { id: toastId });
            const url = await createSheet(tokenResponse.access_token, filename, dataRows);
            toast.success('Sheet created! Opening now...', { id: toastId });
            window.open(url, '_blank');
          } catch (err) {
            console.error('Sheet creation failed', err);
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

  return { exportToSheets, isExporting };
}