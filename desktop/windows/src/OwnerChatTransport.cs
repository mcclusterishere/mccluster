using System;
using System.Collections;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace McClusterDesktop
{
    internal sealed class OwnerChatAuthorityException : InvalidOperationException
    {
        internal OwnerChatAuthorityException(string message) : base(message) { }
    }

    internal interface IOwnerChatTransport
    {
        string SessionId { get; }
        Task<List<OwnerChatTarget>> DiscoverAsync();
        Task<List<OwnerChatThread>> ListThreadsAsync(string sessionId);
        Task<List<OwnerChatTurn>> ListTurnsAsync(string sessionId, string threadId);
        Task StopAsync(OwnerChatTarget target, string threadId, string turnId);
        Task<OwnerChatRun> SubmitAsync(OwnerChatTarget target, string threadId, string messageId, string content);
        Task<OwnerChatRun> GetAsync(OwnerChatTarget target, string threadId, string turnId);
    }

    internal sealed class OwnerChatTarget
    {
        internal string Target, NodeId, Name, Implementation, Model, SessionId;
    }

    internal sealed class OwnerChatRun
    {
        internal string Status, ThreadId, TurnId, Content, Error, NodeId, NodeName, HardwareMode, Model, Implementation, ComputeTaskId;
    }

    internal sealed class OwnerChatThread
    {
        internal string ThreadId, Title;
    }

    internal sealed class OwnerChatTurn
    {
        internal string TurnId, Prompt, Status;
        internal OwnerChatTarget Target;
    }

    internal enum OwnerChatOperation { Discover, Submit, Get, History, Stop }

    internal interface IOwnerChatPage
    {
        Task<Dictionary<string, object>> RequestAsync(OwnerChatOperation operation, Dictionary<string, object> arguments);
    }

    internal sealed partial class OwnerChatTransport : IOwnerChatTransport
    {
        private readonly IOwnerChatPage page;
        public string SessionId { get; private set; }
        private static readonly Regex NodeId = new Regex(@"\Anode_[0-9a-f]{24,64}\z");
        private static readonly Regex Implementation = new Regex(@"\A[a-z0-9][a-z0-9._:-]{0,99}\z");

        internal OwnerChatTransport(IOwnerChatPage page) { this.page = page; }

        private static InvalidOperationException Unverified()
        {
            return new InvalidOperationException("Core returned an incomplete or mismatched receipt. The answer was withheld.");
        }

        private static string Field(object body, string key, int limit)
        {
            string value = Json.Get(body, key) as string;
            if (string.IsNullOrWhiteSpace(value) || value.Length > limit) throw Unverified();
            return value;
        }

        private static bool IsGuid(string value)
        {
            Guid parsed;
            return Guid.TryParseExact(value, "D", out parsed) && parsed != Guid.Empty;
        }

        private static void CheckTarget(OwnerChatTarget target)
        {
            if (target == null || !(target.Target == "ovh" || target.Target == "connected" || target.Target == "prime")
                || !IsGuid(target.SessionId) || !NodeId.IsMatch(target.NodeId ?? "") || !Implementation.IsMatch(target.Implementation ?? "")
                || string.IsNullOrWhiteSpace(target.Model) || target.Model.Length > 200)
                throw new InvalidOperationException("Select a verified worker and model in the signed-in owner workspace.");
        }

        public async Task<List<OwnerChatTarget>> DiscoverAsync()
        {
            Dictionary<string, object> result;
            try { result = await page.RequestAsync(OwnerChatOperation.Discover, new Dictionary<string, object>()); }
            catch { SessionId = null; throw; }
            string session = Field(result, "session_id", 36);
            IList nodes = Json.List(result, "targets");
            if (!IsGuid(session) || nodes == null || nodes.Count > 64) throw Unverified();
            var targets = new List<OwnerChatTarget>();
            foreach (object node in nodes)
            {
                targets.Add(ReadTarget(node, session));
            }
            SessionId = session;
            return targets;
        }

        private static OwnerChatTarget ReadTarget(object row, string session)
        {
            var target = new OwnerChatTarget { Target = Field(row, "target", 12), NodeId = Field(row, "node_id", 72),
                Implementation = Field(row, "implementation", 100), Model = Field(row, "model", 200),
                Name = Field(row, "name", 160), SessionId = session };
            CheckTarget(target);
            return target;
        }

        private void RequireSession(string session)
        {
            if (!IsGuid(session) || SessionId != session) throw new OwnerChatAuthorityException("The signed-in workspace changed. Refresh the chat targets.");
        }

        public async Task<List<OwnerChatThread>> ListThreadsAsync(string sessionId)
        {
            RequireSession(sessionId);
            var result = await page.RequestAsync(OwnerChatOperation.History, new Dictionary<string, object> { { "session_id", sessionId } });
            var threads = Json.List(result, "threads");
            if (threads == null || threads.Count > 40) throw Unverified();
            var items = new List<OwnerChatThread>();
            foreach (object row in threads)
            {
                string id = Field(row, "thread_id", 36);
                if (!IsGuid(id)) throw Unverified();
                items.Add(new OwnerChatThread { ThreadId = id, Title = Field(row, "title", 200) });
            }
            RequireSession(sessionId);
            return items;
        }

        public async Task<List<OwnerChatTurn>> ListTurnsAsync(string sessionId, string threadId)
        {
            RequireSession(sessionId);
            if (!IsGuid(threadId)) throw Unverified();
            var result = await page.RequestAsync(OwnerChatOperation.History, new Dictionary<string, object> { { "session_id", sessionId }, { "thread_id", threadId } });
            var turns = Json.List(result, "turns");
            if (Field(result, "thread_id", 36) != threadId || turns == null || turns.Count > 40) throw Unverified();
            var items = new List<OwnerChatTurn>();
            foreach (object row in turns)
            {
                string id = Field(row, "turn_id", 36), state = Field(row, "status", 16);
                if (!IsGuid(id) || !(state == "done" || state == "pending" || state == "failed" || state == "canceled")) throw Unverified();
                items.Add(new OwnerChatTurn { TurnId = id, Prompt = Field(row, "prompt", 12000), Status = state, Target = ReadTarget(row, sessionId) });
            }
            RequireSession(sessionId);
            return items;
        }

        public async Task StopAsync(OwnerChatTarget target, string threadId, string turnId)
        {
            var args = Arguments(target, threadId, turnId);
            args.Add("turn_id", turnId);
            var result = await page.RequestAsync(OwnerChatOperation.Stop, args);
            if (ReadState(result, threadId, turnId).Status != "canceled") throw new InvalidOperationException("Core did not confirm that the turn was stopped. Reconnect to check the receipt.");
        }

        private Dictionary<string, object> Arguments(OwnerChatTarget target, string threadId, string turnId)
        {
            CheckTarget(target);
            RequireSession(target.SessionId);
            if (!IsGuid(threadId) || !IsGuid(turnId)) throw new InvalidOperationException("This conversation or turn has an invalid identifier.");
            return new Dictionary<string, object> { { "session_id", target.SessionId }, { "target", target.Target },
                { "node_id", target.NodeId }, { "implementation", target.Implementation }, { "thread_id", threadId } };
        }

        public async Task<OwnerChatRun> SubmitAsync(OwnerChatTarget target, string threadId, string messageId, string content)
        {
            var args = Arguments(target, threadId, messageId);
            if (string.IsNullOrWhiteSpace(content) || content.Length > 12000)
                throw new InvalidOperationException("Enter a message of up to 12,000 characters.");
            args.Add("message_id", messageId);
            args.Add("content", content);
            var result = await page.RequestAsync(OwnerChatOperation.Submit, args);
            var run = ReadState(result, threadId, messageId);
            if (run.Status != "pending") throw Unverified();
            return run;
        }

        private static OwnerChatRun ReadState(object result, string threadId, string turnId)
        {
            if (!string.Equals(Field(result, "thread_id", 36), threadId, StringComparison.OrdinalIgnoreCase)
                || !string.Equals(Field(result, "turn_id", 36), turnId, StringComparison.OrdinalIgnoreCase)) throw Unverified();
            return new OwnerChatRun { ThreadId = threadId, TurnId = turnId, Status = Field(result, "status", 16) };
        }

        public async Task<OwnerChatRun> GetAsync(OwnerChatTarget target, string threadId, string turnId)
        {
            var args = Arguments(target, threadId, turnId);
            args.Add("turn_id", turnId);
            var result = await page.RequestAsync(OwnerChatOperation.Get, args);
            var run = ReadState(result, threadId, turnId);
            if (run.Status == "pending") return run;
            if (run.Status == "failed")
            {
                run.Error = "The selected Core turn failed or was refused. No verified answer is available.";
                return run;
            }
            if (run.Status != "done" || Field(result, "target", 12) != target.Target || Field(result, "node_id", 72) != target.NodeId
                || Field(result, "implementation", 100) != target.Implementation || Field(result, "model", 200) != target.Model) throw Unverified();
            run.NodeId = target.NodeId;
            run.NodeName = Field(result, "node_name", 160);
            run.Implementation = target.Implementation;
            run.Model = target.Model;
            run.HardwareMode = Json.Get(result, "hardware_mode") as string;
            if ((target.Target == "ovh" && run.HardwareMode != "cpu-only") || (target.Target == "prime" && run.HardwareMode != "gpu-verified")) throw Unverified();
            if (target.Target == "connected" && run.HardwareMode != "cpu-only" && run.HardwareMode != "gpu-verified") run.HardwareMode = null;
            run.ComputeTaskId = Field(result, "compute_task_id", 36);
            if (!IsGuid(run.ComputeTaskId)) throw Unverified();
            run.Content = Field(result, "content", 30000);
            return run;
        }
    }
}
