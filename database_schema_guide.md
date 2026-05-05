# Timetable Generator: Live Database Schema Guide

The database architecture follows a logical progression from raw entities to final scheduled events. It is structured into four main categories: **Ingredients** (Master Data), **Rules** (Connections), **Blueprints** (Context), and the **Final Meal** (Output).

## 1. The "Ingredients" (Master Data)
These tables hold the core, independent entities of your college. You set them up once, and they rarely change.

* **`professors`**
  * **What it holds:** The master list of all faculty members (`name`, `email`, `department`, `availability`).
  * **Role:** The workforce. The engine reads this to know who is available to teach.
* **`rooms`**
  * **What it holds:** Physical locations for classes (`name`, `capacity`, `room_type`).
  * **Role:** Ensures classes are assigned to appropriate spaces (e.g., Practicals only go into rooms where `room_type = 'Lab'`).
* **`student_groups`**
  * **What it holds:** The actual batches/sections of students (`name`, `student_count`, `semester`, `program`, `group_type`).
  * **Role:** Represents the students attending. The engine ensures that a single student group isn't double-booked.
* **`subjects`**
  * **What it holds:** The catalog of every course offered. It holds the **L-T-P structure** (`lectures`, `tutorials`, `practicals`, `practical_duration`) so the solver knows exactly how many slots to find.
  * > [!TIP]
    > **`elective_group`**: A field used to loosely tag subjects that belong to specific pools (e.g., "Professional Elective 1").

## 2. The "Rules" (Connection Tables)
These tables link your ingredients together so the engine knows what is allowed.

* **`professor_expertise`**
  * **What it holds:** Links a `professor_id` to a `subject_id` with a `preference_level`.
  * **Role:** Tells the engine who is qualified to teach what. If a subject needs a teacher, the engine will only pick a professor mapped to that subject here, preventing a Math professor from being assigned to a Physics lab.

## 3. The "Blueprint" (Context Tables)
These tables tell the engine exactly what it is trying to schedule *right now*.

* **`semester_clusters`**
  * **What it holds:** Groups your scheduling context into a specific container (e.g., `batch_year: 2025`, `semester_number: 4`, `department: 'IT'`).
  * **Role:** When you click generate, you pass the `cluster_id` to the engine so it knows exactly which batch it is solving for, rather than trying to schedule the entire college at once.
* **`cluster_requirements`**
  * **What it holds:** A mapping table linking a `cluster_id` to multiple `subject_id`s.
  * **Role:** Tells the engine exactly *which* subjects belong to the active cluster. The engine grabs this "shopping list," looks up their L-T-P structures, and starts scheduling them.
  * > [!IMPORTANT]
    > **Elective Logic (`elective_basket` & `estimated_enrollment`)**: This is where the advanced elective logic lives. `elective_basket` defines exactly which sync group (like "HSMC" or "MDM") or free basket the subject belongs to for this specific semester.

## 4. The "Final Meal" (Output Tables)
These tables store the final results of the generation process.

* **`timetables`**
  * **What it holds:** The top-level container for a generated schedule (`name`, `academic_year`, `semester`, `status`, `lunch_start`, `lunch_end`). 
  * **Role:** Organizes your generated results (e.g., keeping track of "Drafts" vs "Published" schedules).
* **`timetable_slots`**
  * **What it holds:** This is where the final generated schedule lives. It links everything together: `timetable_id`, `professor_id`, `subject_id`, `room_id`, `student_group_id`, `day_of_week`, `start_time`, `end_time`, and `slot_type` into a single exact event.
  * **Role:** 
    1. **To Save:** When the algorithm finishes, it writes the final placements here.
    2. **To Avoid Conflicts:** When generating a *new* timetable, the engine first reads the `timetable_slots` of *published* timetables. If a professor is already saved in a slot at 10:00 AM for Semester 6, the engine knows that 10:00 AM is blocked and won't schedule him for Semester 4 at that time.
