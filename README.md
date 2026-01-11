# Campus Timetable & Occupancy Manager

A comprehensive, real-time timetable management system built with **React**, **TypeScript**, and **Supabase**. This application allows administrators to import schedule data and provides students, faculty, and staff with specialized views to visualize schedules, find free rooms, and generate PDF exports.

## Features

* **🎓 Student Custom View:**
    * **Smart Merging:** Automatically merges specific Section classes (e.g., "Sec B") with common lectures ("Sec All").
    * **Personalization:** Students can filter by Semester and Section, then uncheck elective subjects they don't take.
    * **Persistence:** Saves user preferences (Semester, Section, Subjects) locally so they don't have to re-select on every visit.
* **👨‍🏫 Professor Schedule:** Filter timetables by faculty name to see teaching loads and specific class locations.
* **🏫 Master Room View:** A bird's-eye view of the entire campus occupancy across all rooms.
* **☕ Free Room Finder:** Instantly identifies available rooms for any given time slot by inverting the busy schedule logic.
* **📄 PDF Export:** Robust PDF generation for all views (Student, Professor, Room, and Free Rooms) using `html-to-image` and `jsPDF`.
* **🔐 Role-Based Access:** Supabase Authentication to secure administrative import features.

## Visuals

### Single Student View
![Student Custom Timetable](.\screenshots\custom_tt.png)

### Master Occupancy
![Master Room Grid](.\screenshots\master_view.png)

### Free Room Finder
![Free Room Grid](.\screenshots\free_room.png)

## Tech Stack

* **Frontend:** React, TypeScript, Tailwind CSS
* **Backend/Database:** Supabase (PostgreSQL)
* **Icons:** Lucide React
* **PDF Generation:** `html-to-image`, `jspdf`
* **Date/Time:** Native JS (Custom helpers for 24h->12h conversion)

## Installation

Use [npm](https://www.npmjs.com/) to install the dependencies.

```bash
# Clone the repository
git clone https://github.com/toad-of-code/timetable-editor-and-generator.git

# Navigate to the directory
cd timetable-editor-and-generator

# Install dependencies
npm install

# Start the development server
npm run dev

```

## Configuration

This project uses **Supabase** for data storage and authentication. You need to create a `.env` file in the root directory.

1. Create `.env`:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

```
Follow `.env.example` for for details.

2. **Database Schema:**
Ensure your Supabase project has the following tables:
* `timetables` (id, name, status, created_at)
* `timetable_slots` (id, timetable_id, day_of_week, start_time, end_time, subject_id, professor_id, room_id, group_id, ...)
* *Related tables:* `subjects`, `professors`, `rooms`, `student_groups`.



## Usage

### For Students

1. Navigate to **"Students"** or **"My Timetable"**.
2. Select your **Semester** and **Section**.
3. The system automatically selects all Core + Elective subjects.
4. Uncheck the subjects you are *not* taking.
5. Click **PDF** to download your personalized schedule.

### For Faculty

1. Navigate to **"Professors"**.
2. Select your name from the dropdown.
3. View your weekly teaching schedule and download it.

### For Admin (Importing)

1. Log in using the Admin credentials.
2. Navigate to **"Import"**.
3. Upload the Master Excel/CSV file to populate the database.

## PDF Export Notes

The PDF generation uses a specific logic to handle "Sticky Headers" in React. If you modify the styling, ensure you maintain the `position: static` override in the `html-to-image` configuration to prevent the header from cutting off or glitching in the generated file.

```javascript
style: { 
   overflow: 'visible',
   height: 'auto',
   position: 'static' // Critical for correct rendering
}

```

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

[MIT](LICENSE)

## Authors

* **Rahul Roy** - *Initial work*

## Acknowledgments

* Inspiration from [Make a README](https://www.makeareadme.com/)
* Icons provided by [Lucide](https://lucide.dev/)