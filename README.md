# Campus Timetable — Editor & Generator

A comprehensive timetable management system for **IIIT Allahabad**, built with **React 19**, **TypeScript**, **Tailwind CSS v4**, and **Supabase**. The platform covers the full lifecycle — from master data management and automated schedule generation to manual editing, constraint validation, and multi-format PDF exports.

---

## Features

### Automated Timetable Generator (Solver)

* **(1+1)-ES evolutionary solver** with Gaussian mutations and the **1/5th Success Rule** for adaptive step-size control.
* **10 hard constraints** (room overlap, professor overlap, group clashes, time boundaries, break crossings, lab-room enforcement, WMC-section overlap, home-room policy, 2+1 lecture format, elective sync).
* **3 soft constraints** (student gap penalty, room utilization, professor same-half).
* **Synced & Free elective baskets** — strict time-lock for MDM/HSMC baskets; independent scheduling for others.
* Real-time solver progress UI with fitness graph and generation counter.

### Interactive Timetable Editor

* Drag-and-drop session placement on a visual weekly grid.
* **Local Neighbourhood Search (LNS)** — after each drag, a lightweight optimiser runs to eliminate new violations.
* **Full LNS** — one-click "Fix All" that destroys and repairs all clashing sessions.
* Live **feasibility indicator** showing hard/soft violation counts.
* **Master View** aggregating sessions across active and published timetables.

### Master Data Management (MDM)

| Module | Description |
|---|---|
| **Manage Professors** | CRUD for faculty, including expertise area assignments |
| **Manage Subjects** | CRUD for subjects with code, credits, type (Core/Elective/Minor), and lecture format |
| **Manage Rooms** | CRUD for rooms with type (Lecture/Lab) and capacity |
| **Semester Mapping** | Assign subjects to semester clusters for scheduling |

### Timetable Importer

* Bulk import from **Excel/CSV** files via `xlsx`.
* Validates and maps rows to the relational schema before insert.

### Viewer Modules

* **Student View** — smart merging of section + "Sec All" classes, elective filtering, local preference persistence.
* **Professor View** — per-faculty weekly schedule lookup.
* **Room View** — per-room weekly schedule.
* **Master Occupancy** — bird's-eye campus-wide room occupancy grid.
* **Free Room Finder** — inverts the occupancy data to show available rooms per slot.
* **Semester Subject List (Report Card)** — overview of subjects offered per semester cluster.

### PDF Export

* Robust PDF generation for all views using `html-to-image` + `jsPDF`.

### Authentication

* Supabase Auth with role-based access control for admin features.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | React 19, TypeScript 5.9 |
| **Styling** | Tailwind CSS v4 |
| **Backend / DB** | Supabase (PostgreSQL, Auth, RLS) |
| **Build Tool** | Vite 7 |
| **Icons** | Lucide React |
| **PDF** | html-to-image, jsPDF |
| **Spreadsheet** | xlsx |
| **Notifications** | react-hot-toast |

---

## Project Structure

```
src/
├── solver/                  # Evolutionary solver engine
│   ├── types.ts             # SolverInput, Gene, FitnessResult types
│   ├── constants.ts         # Time-slot mapping, synced baskets, breaks
│   ├── constraints.ts       # Hard & soft constraint evaluation
│   ├── mutations.ts         # Relocate, time-shift, room-swap mutations
│   ├── solver.ts            # (1+1)-ES main loop
│   ├── localSearch.ts       # LNS for editor drag-and-drop repair
│   ├── dataPrep.ts          # Supabase → SolverInput transformation
│   ├── solverLog.ts         # Detailed violation log renderer
│   └── externalEvaluator.ts # Evaluate external (published) timetables
│
├── components/
│   ├── GeneratorView.tsx    # Solver UI (cluster select → run → results)
│   ├── EditorView.tsx       # Drag-and-drop timetable editor + LNS
│   ├── TimetableImporter.tsx# Excel/CSV bulk import
│   ├── TimetableViewer.tsx  # Student custom view
│   ├── ProfessorTimetableViewer.tsx
│   ├── RoomTimetableViewer.tsx
│   ├── MasterRoomViewer.tsx # Campus-wide occupancy grid
│   ├── FreeRoomViewer.tsx   # Available room finder
│   ├── ReportCardView.tsx   # Semester subject list
│   ├── ManageProfessors.tsx # Faculty CRUD + expertise
│   ├── ManageSubjects.tsx   # Subject CRUD
│   ├── ManageRooms.tsx      # Room CRUD
│   ├── ManageSemesterMapping.tsx # Semester ↔ Subject mapping
│   ├── AuthForm.tsx         # Login / signup
│   └── generator/           # Generator sub-components
│       ├── ClusterSelector.tsx
│       ├── HomeRoomMapper.tsx
│       ├── AssignmentMatrix.tsx
│       ├── SolverProgress.tsx
│       └── SolverResults.tsx
│
├── contexts/                # React context providers (Auth)
├── hooks/                   # Custom hooks (generator data, etc.)
├── lib/                     # Supabase client initialisation
├── App.tsx                  # Sidebar navigation + view router
└── main.tsx                 # Entry point
```

---

## Installation

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

---

## Configuration

This project uses **Supabase** for data storage and authentication. Create a `.env` file in the root directory:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

See `.env.example` for details.

### Database Schema

Ensure your Supabase project has the following core tables:

* `timetables` (id, name, status, semester_cluster_id, created_at)
* `timetable_slots` (id, timetable_id, day_of_week, start_time, end_time, subject_id, professor_id, room_id, student_group_id, slot_type, ...)
* `subjects` (id, code, name, credits, subject_type, lecture_format, ...)
* `professors` (id, name, email, ...)
* `rooms` (id, name, room_type, capacity, ...)
* `student_groups` (id, name, semester_cluster_id, ...)
* `semester_clusters` (id, name, ...)
* `professor_expertise` (professor_id, subject_area)
* `cluster_requirements` (cluster_id, subject_id, ...)

---

## Usage

### Generating a Timetable

1. Navigate to **Generator**.
2. Select a **Semester Cluster**.
3. Configure **Home Room** assignments for each section.
4. Set **Professor ↔ Subject** assignments in the matrix.
5. Click **Generate** — the solver runs in-browser and displays real-time progress.
6. Review the result and **Publish** to save.

### Editing a Timetable

1. Navigate to **Editor**.
2. Select an active timetable.
3. Drag sessions to rearrange — the LNS auto-repairs constraint violations.
4. Use **Fix All** for a full neighbourhood repair pass.
5. Monitor the feasibility badge for zero hard violations before publishing.

### Viewing Timetables

* **Students** — select semester + section, deselect unwanted electives, export PDF.
* **Professors** — pick a faculty name, view/download schedule.
* **Rooms / Occupancy / Free Rooms** — campus-wide visibility.

### Master Data Management

Navigate to **Manage Professors / Subjects / Rooms / Semester Mapping** in the sidebar to maintain reference data.

---

## PDF Export Notes

The PDF pipeline uses `html-to-image` to rasterise the timetable grid, then `jsPDF` to compose the final document. If you modify table styling, ensure you preserve the `position: static` override in the capture config to prevent sticky-header rendering artefacts:

```javascript
style: {
  overflow: 'visible',
  height: 'auto',
  position: 'static' // Critical for correct rendering
}
```

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## License

[MIT](LICENSE)

## Authors

* **Rahul Roy** 
* **Lakavath Peer Singh** 
* **Eshant** 


## Acknowledgments

* Inspiration from [Make a README](https://www.makeareadme.com/)
* Icons provided by [Lucide](https://lucide.dev/)