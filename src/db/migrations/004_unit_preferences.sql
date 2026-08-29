ALTER TABLE users ADD COLUMN unit_language TEXT NOT NULL DEFAULT 'de' CHECK(unit_language IN ('de','en'));
ALTER TABLE users ADD COLUMN measurement_system TEXT NOT NULL DEFAULT 'metric' CHECK(measurement_system IN ('metric','imperial'));
