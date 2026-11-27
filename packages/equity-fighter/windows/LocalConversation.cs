using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace McClusterDesktop
{
    // Read-only thread projections over the device job ledger. Every local follow-up
    // binds a bounded list of prior verified device job references into its own signed input.
    internal sealed class LocalConversation
    {
        internal const int MaxPrompt = 4096;
        private const int MaxHistory = 4;
        private const int MaxHistoryChars = 6000;
        private const int MaxListedThreads = 60;
        private const int MaxListedTurns = 80;
        internal string Id { get; private set; }
        internal string Title { get; private set; }
        internal string Route { get { return "prime"; } }
        internal string Label { get { return Title + " · Prime"; } }
        internal LocalConversation() : this(Guid.NewGuid().ToString("N")) { }

        private LocalConversation(string id) { Id = id; Title = "New chat"; }
        public override string ToString() { return Label; }
        internal readonly List<LocalJob> Turns = new List<LocalJob>();

        private static string PromptTitle(string prompt)
        {
            string line = string.Join(" ", prompt.Split((char[])null, StringSplitOptions.RemoveEmptyEntries));
            if (line.Length <= 56) return line;
            int cut = char.IsHighSurrogate(line[54]) ? 54 : 55;
            return line.Substring(0, cut).TrimEnd() + "…";
        }

        private static bool HasLocalThread(LocalJob job)
        {
            Guid id;
            string route = Json.Str(job.Input, "local_chat_route");
            return job.Kind == JobKind.Chat && job.Target == JobTarget.LocalDevice &&
                Guid.TryParseExact(Json.Str(job.Input, "local_chat_id"), "N", out id) &&
                Json.Str(job.Input, "device") == DeviceChoice.Ollama && (route == null || route == "prime") &&
                Json.Str(job.Receipt, "schema") == "mccluster-desktop-receipt/2" &&
                Json.Str(job.Receipt, "kind") == JobKind.Chat && Json.Str(job.Receipt, "evidence_scope") == "local_device_only" &&
                Equals(Json.Get(job.Receipt, "hosted_inference_used"), false) &&
                (job.State == JobState.Done || job.State == JobState.Failed);
        }

        internal static List<LocalConversation> Restore(JobStore store)
        {
            var threads = new List<LocalConversation>();
            var candidates = store.List().Where(HasLocalThread)
                .OrderByDescending(j => Json.Str(j.Receipt, "finished_at") ?? "", StringComparer.Ordinal)
                .ThenByDescending(j => j.Id, StringComparer.Ordinal).ToList();
            if (candidates.Count == 0) return threads;
            var byId = new Dictionary<string, LocalConversation>(StringComparer.Ordinal);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            using (DeviceKey key = DeviceKey.Load(store.Root))
            {
                foreach (LocalJob job in candidates)
                {
                    LocalConversation chat;
                    string id = Json.Str(job.Input, "local_chat_id");
                    if (!byId.TryGetValue(id, out chat) && threads.Count >= MaxListedThreads) continue;
                    if (chat != null && chat.Turns.Count >= MaxListedTurns) continue;
                    if (seen.Contains(job.Id) || !Verifies(job, key.KeyId)) continue;
                    seen.Add(job.Id);
                    if (chat == null)
                    {
                        chat = new LocalConversation(id);
                        threads.Add(chat);
                        byId.Add(id, chat);
                    }
                    string title = Json.Str(job.Input, "local_chat_title") ?? Json.Str(job.Input, "prompt");
                    chat.Title = PromptTitle(title);
                    // Failures have no signed answer. Use the signed failure text when reopening.
                    if (job.State == JobState.Failed) { job.Result = null; job.Error = Json.Str(job.Receipt, "failure"); }
                    chat.Turns.Add(job);
                }
            }
            foreach (var chat in threads) chat.Turns.Reverse();
            return threads;
        }

        internal LocalJob Create(JobStore store, string model, string prompt)
        {
            if (string.IsNullOrWhiteSpace(model) || string.IsNullOrWhiteSpace(prompt) || prompt.Length > MaxPrompt)
                throw new ArgumentException("Choose an installed model and enter a message of up to 4,096 characters.");
            string title = Turns.Count == 0 ? PromptTitle(prompt) : Title;
            var history = new List<string>();
            int chars = 0;
            foreach (LocalJob past in Turns.AsEnumerable().Reverse().Where(j => j.State == JobState.Done).Take(MaxHistory))
            {
                chars += (Json.Str(past.Input, "prompt") ?? "").Length + (Json.Str(past.Result, "content") ?? "").Length;
                if (chars > MaxHistoryChars) break;
                history.Add(past.Id);
            }
            history.Reverse();
            LocalJob job = store.Create(JobKind.Chat, JobTarget.LocalDevice, new Dictionary<string, object> {
                { "local_chat_id", Id }, { "local_chat_title", title }, { "local_chat_route", Route },
                { "history_jobs", history }, { "model", model }, { "prompt", prompt },
                { "device", DeviceChoice.Ollama }, { "max_attempts", 1 } });
            Title = title;
            Turns.Add(job);
            return job;
        }

        internal static List<object> Messages(JobStore store, LocalJob job, string prompt)
        {
            var messages = new List<object>();
            string threadId = Json.Str(job.Input, "local_chat_id");
            var history = Json.List(job.Input, "history_jobs");
            if (threadId != null && history != null && history.Count > 0)
            {
                Guid guid;
                if (!Guid.TryParseExact(threadId, "N", out guid) || history.Count > MaxHistory)
                    throw new InvalidDataException("This turn has invalid local history.");
                int chars = 0;
                var seen = new HashSet<string>(StringComparer.Ordinal);
                using (DeviceKey key = DeviceKey.Load(store.Root))
                {
                    foreach (object entry in history)
                    {
                        string id = entry as string;
                        if (id == null || !id.StartsWith("job_", StringComparison.Ordinal) ||
                            !Guid.TryParseExact(id.Substring(4), "N", out guid) || !seen.Add(id))
                            throw new InvalidDataException("The local conversation contains an invalid job reference.");
                        LocalJob past = store.Get(id);
                        if (past == null || past.Id != id || past.State != JobState.Done ||
                            past.Kind != JobKind.Chat || past.Target != JobTarget.LocalDevice ||
                            Json.Str(past.Input, "local_chat_id") != threadId ||
                            !Verifies(past, key.KeyId))
                            throw new InvalidDataException("An earlier local turn could not be verified. Start a new chat to continue.");
                        string question = Json.Str(past.Input, "prompt") ?? "";
                        string answer = Json.Str(past.Result, "content") ?? "";
                        chars += question.Length + answer.Length;
                        if (chars > MaxHistoryChars || string.IsNullOrWhiteSpace(answer) || string.IsNullOrWhiteSpace(question))
                            throw new InvalidDataException("The local conversation context is invalid.");
                        messages.Add(Message("user", question));
                        messages.Add(Message("assistant", answer));
                    }
                }
            }
            messages.Add(Message("user", prompt));
            return messages;
        }

        internal static bool Verifies(LocalJob job, string keyId)
        {
            Guid id;
            string prompt = Json.Str(job.Input, "prompt");
            if (!HasLocalThread(job) || string.IsNullOrWhiteSpace(prompt) || prompt.Length > MaxPrompt ||
                job.Id == null || !job.Id.StartsWith("job_", StringComparison.Ordinal) || !Guid.TryParseExact(job.Id.Substring(4), "N", out id)) return false;
            var proof = ReceiptVerifier.Verify(job.ToDictionary(), keyId, false);
            return Equals(proof["verified"], true) && Equals(proof["job_id_matches"], true) &&
                Equals(proof["input_matches"], true) && Json.Str(job.Receipt, "state") == job.State &&
                (job.State != JobState.Done || Equals(proof["output_matches"], true));
        }

        private static Dictionary<string, object> Message(string role, string text)
        {
            return new Dictionary<string, object> { { "role", role }, { "content", text } };
        }
    }
}
