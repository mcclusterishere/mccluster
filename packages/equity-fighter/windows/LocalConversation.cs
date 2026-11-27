using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace McClusterDesktop
{
    // The window owns this list. The existing signed job files remain the only
    // on-device record. A follow-up binds a bounded list of prior jobs into its input.
    internal sealed class LocalConversation
    {
        internal const int MaxPrompt = 4096;
        private const int MaxHistory = 4;
        private const int MaxHistoryChars = 6000;
        private readonly string thread = Guid.NewGuid().ToString("N");
        internal readonly List<LocalJob> Turns = new List<LocalJob>();

        internal LocalJob Create(JobStore store, string model, string prompt)
        {
            if (string.IsNullOrWhiteSpace(model) || string.IsNullOrWhiteSpace(prompt) || prompt.Length > MaxPrompt)
                throw new ArgumentException("Choose an installed model and enter a message of up to 4,096 characters.");
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
                { "local_chat_id", thread }, { "history_jobs", history }, { "model", model }, { "prompt", prompt },
                { "device", DeviceChoice.Ollama }, { "max_attempts", 1 } });
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
