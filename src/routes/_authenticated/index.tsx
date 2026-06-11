import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Download, LogOut, Trash2, Loader2, FileSpreadsheet, Pencil, Bell, BellOff } from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "My Tasks — Task Tracker" },
      { name: "description", content: "Add tasks, set deadlines, and export to Excel." },
    ],
  }),
  component: TasksPage,
});

type Task = {
  id: string;
  person_name: string;
  task: string;
  deadline: string;
  created_at: string;
};

const NOTIFIED_KEY = "task-tracker-notified-ids";
const getNotified = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "[]");
  } catch {
    return [];
  }
};
const addNotified = (id: string) => {
  const set = new Set(getNotified());
  set.add(id);
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set]));
};

function playBeep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beepAt = (start: number, freq: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.4);
    };
    beepAt(0, 880);
    beepAt(0.45, 880);
    beepAt(0.9, 1100);
    setTimeout(() => ctx.close().catch(() => {}), 2000);
  } catch {
    // ignore
  }
}

function TasksPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [email, setEmail] = useState<string>("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [notificationsOn, setNotificationsOn] = useState(false);
  const tasksRef = useRef<Task[]>([]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const load = async () => {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, person_name, task, deadline, created_at")
      .order("deadline", { ascending: true });
    if (error) toast.error(error.message);
    else setTasks((data ?? []) as Task[]);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
    load();
    if (typeof Notification !== "undefined") {
      setNotificationsOn(Notification.permission === "granted");
    }
  }, []);

  const checkDeadlines = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const notified = new Set(getNotified());
    const due = tasksRef.current.filter(
      (t) => !notified.has(t.id) && new Date(t.deadline) <= today,
    );
    if (due.length === 0) return;
    playBeep();
    due.forEach((t) => {
      toast.warning(`Deadline reached: ${t.task}`, {
        description: `${t.person_name} — due ${t.deadline}`,
        duration: 8000,
      });
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification("Task deadline reached", {
            body: `${t.person_name}: ${t.task} (due ${t.deadline})`,
            tag: t.id,
          });
        } catch {
          // ignore
        }
      }
      addNotified(t.id);
    });
  };

  useEffect(() => {
    if (loading) return;
    const t = setTimeout(checkDeadlines, 400);
    const interval = setInterval(checkDeadlines, 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const enableNotifications = async () => {
    if (typeof Notification === "undefined") {
      toast.error("Notifications not supported in this browser");
      return;
    }
    const perm = await Notification.requestPermission();
    setNotificationsOn(perm === "granted");
    if (perm === "granted") {
      toast.success("Notifications enabled");
      playBeep();
    } else {
      toast.error("Notifications blocked");
    }
  };

  const onAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const person_name = String(fd.get("person_name") ?? "").trim();
    const task = String(fd.get("task") ?? "").trim();
    const deadline = String(fd.get("deadline") ?? "");
    if (!person_name || !task || !deadline) {
      toast.error("Please fill all fields");
      return;
    }
    setSubmitting(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("tasks")
      .insert({ person_name, task, deadline, user_id: userData.user!.id });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Task added");
    form.reset();
    load();
  };

  const onDelete = async (id: string) => {
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Task deleted");
      load();
    }
  };

  const onSaveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    const person_name = String(fd.get("person_name") ?? "").trim();
    const task = String(fd.get("task") ?? "").trim();
    const deadline = String(fd.get("deadline") ?? "");
    if (!person_name || !task || !deadline) {
      toast.error("Please fill all fields");
      return;
    }
    setSavingEdit(true);
    const { error } = await supabase
      .from("tasks")
      .update({ person_name, task, deadline })
      .eq("id", editing.id);
    setSavingEdit(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    // Reset notified flag so changed deadlines can re-alert
    const remaining = getNotified().filter((id) => id !== editing.id);
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(remaining));
    toast.success("Task updated");
    setEditing(null);
    load();
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Tasks");
      ws.columns = [
        { header: "Person", key: "person_name", width: 24 },
        { header: "Task", key: "task", width: 48 },
        { header: "Deadline", key: "deadline", width: 16 },
        { header: "Created", key: "created_at", width: 22 },
      ];
      ws.getRow(1).font = { bold: true };
      tasks.forEach((t) =>
        ws.addRow({
          person_name: t.person_name,
          task: t.task,
          deadline: t.deadline,
          created_at: new Date(t.created_at).toLocaleString(),
        }),
      );
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tasks-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Excel downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const onSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const isOverdue = (deadline: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(deadline) <= today;
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <h1 className="text-base font-semibold">Task Tracker</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={enableNotifications}
              title={notificationsOn ? "Notifications on" : "Enable notifications"}
            >
              {notificationsOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={onSignOut}>
              <LogOut className="mr-1.5 h-4 w-4" />Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Add a task</CardTitle>
            <CardDescription>Assign a task with a deadline. It saves instantly.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onAdd} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="person_name">Person</Label>
                <Input id="person_name" name="person_name" placeholder="e.g. Alex" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task">Task</Label>
                <Input id="task" name="task" placeholder="Describe the task" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deadline">Deadline</Label>
                <Input id="deadline" name="deadline" type="date" required />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add task
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Your tasks</CardTitle>
              <CardDescription>{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</CardDescription>
            </div>
            <Button onClick={onExport} disabled={exporting || tasks.length === 0} variant="default">
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              View Excel
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : tasks.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No tasks yet. Add your first one above.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.person_name}</TableCell>
                      <TableCell>{t.task}</TableCell>
                      <TableCell className={isOverdue(t.deadline) ? "text-destructive font-medium" : ""}>
                        {t.deadline}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => setEditing(t)} aria-label="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => onDelete(t.id)} aria-label="Delete">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit task</DialogTitle>
            <DialogDescription>Update the person, task, or deadline.</DialogDescription>
          </DialogHeader>
          {editing && (
            <form onSubmit={onSaveEdit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit_person_name">Person</Label>
                <Input id="edit_person_name" name="person_name" defaultValue={editing.person_name} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit_task">Task</Label>
                <Input id="edit_task" name="task" defaultValue={editing.task} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit_deadline">Deadline</Label>
                <Input id="edit_deadline" name="deadline" type="date" defaultValue={editing.deadline} required />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={savingEdit}>
                  {savingEdit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
