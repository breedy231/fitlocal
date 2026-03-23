export interface MFPNutrition {
  calories: number;
  protein: number;
}

export async function getMFPNutrition(
  username: string,
  sessionCookie: string
): Promise<MFPNutrition | null> {
  try {
    const res = await fetch(`https://www.myfitnesspal.com/food/diary/${username}`, {
      headers: {
        Cookie: sessionCookie,
        'User-Agent': 'FitLocal/1.0',
      },
    });
    if (!res.ok) return null;

    const html = await res.text();

    // Parse total calories from the diary page
    const calorieMatch = html.match(/Calories<\/td>\s*(?:<td[^>]*>\s*[\d,]+\s*<\/td>\s*)*<td[^>]*class="total"[^>]*>\s*([\d,]+)/i)
      || html.match(/total.*?(\d[\d,]+)\s*cal/i);
    const proteinMatch = html.match(/Protein<\/td>\s*(?:<td[^>]*>\s*[\d,]+\s*<\/td>\s*)*<td[^>]*class="total"[^>]*>\s*([\d,]+)/i)
      || html.match(/total.*?protein.*?(\d[\d,]+)/i);

    const calories = calorieMatch ? parseInt(calorieMatch[1].replace(/,/g, '')) : 0;
    const protein = proteinMatch ? parseInt(proteinMatch[1].replace(/,/g, '')) : 0;

    if (calories === 0) return null;
    return { calories, protein };
  } catch {
    return null;
  }
}
