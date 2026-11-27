using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using McClusterDesktop;

internal static class OwnerChatTests
{
    private sealed class Fixture : IOwnerChatPage
    {
        internal readonly string Session = Guid.NewGuid().ToString(), Thread = Guid.NewGuid().ToString(), Turn = Guid.NewGuid().ToString();
        internal readonly string Node = "node_" + new string('a', 40), Model = "qwen3:8b", Impl = "qwen3.8b.local";
        internal string Served, Hardware = "cpu-only", Runtime, ReturnedTurn, ComputeTaskId = Guid.NewGuid().ToString();
        internal Dictionary<string, object> Submitted;
        internal bool SignedIn = true, CanStop = true, ConfirmedStop = true;
        public Task<Dictionary<string, object>> RequestAsync(OwnerChatOperation op, Dictionary<string, object> args)
        {
            if (!SignedIn) throw new OwnerChatAuthorityException("The house owner has signed out.");
            if (op == OwnerChatOperation.History)
            {
                if (!args.ContainsKey("thread_id"))
                    return Task.FromResult(new Dictionary<string, object> { { "threads", new object[] { new Dictionary<string, object> { { "thread_id", Thread }, { "title", "A previous run" } } } } });
                return Task.FromResult(new Dictionary<string, object> { { "thread_id", Thread }, { "turns", new object[] { new Dictionary<string, object> {
                    { "turn_id", Turn }, { "prompt", "History fixture" }, { "status", "done" }, { "target", "ovh" }, { "node_id", Node }, { "name", "Owner CPU" }, { "implementation", Impl }, { "model", Model }
                } } } });
            }
            if (op == OwnerChatOperation.Stop)
                return Task.FromResult(new Dictionary<string, object> { { "thread_id", Thread }, { "turn_id", Turn }, { "status", ConfirmedStop ? "canceled" : "pending" } });
            if (op == OwnerChatOperation.Discover)
                return Task.FromResult(new Dictionary<string, object> { { "can_stop", CanStop }, { "session_id", Session }, { "targets", new object[] {
                    new Dictionary<string, object> { { "target", "ovh" }, { "name", "Owner CPU" }, { "node_id", Node }, { "implementation", Impl }, { "model", Model } }
                } } });
            if (op == OwnerChatOperation.Submit) Submitted = args;
            var result = new Dictionary<string, object> { { "thread_id", Thread }, { "turn_id", ReturnedTurn ?? Turn },
                { "status", op == OwnerChatOperation.Submit ? "pending" : "done" }, { "target", "ovh" }, { "node_id", Served ?? Node },
                { "node_name", "Owner CPU" }, { "implementation", Impl }, { "model", Runtime ?? Model }, { "hardware_mode", Hardware },
                { "compute_task_id", ComputeTaskId }, { "content", "Fixture answer." } };
            return Task.FromResult(result);
        }
    }

    internal static void Run(Action<bool, string> check)
    {
        var fixture = new Fixture();
        var transport = new OwnerChatTransport(fixture);
        var target = transport.DiscoverAsync().GetAwaiter().GetResult()[0];
        check(target.Target == "ovh" && target.SessionId == fixture.Session, "discovery binds the selected target to its owner page session");
        var accepted = transport.SubmitAsync(target, fixture.Thread, fixture.Turn, "Benign fixture prompt.").GetAwaiter().GetResult();
        check(accepted.Status == "pending" && accepted.TurnId == fixture.Turn, "durable admission retains the caller's idempotency ID");
        check(fixture.Submitted.Count == 7 && Json.Str(fixture.Submitted, "session_id") == fixture.Session && Json.Str(fixture.Submitted, "message_id") == fixture.Turn
            && Json.Str(fixture.Submitted, "content") == "Benign fixture prompt.", "only the narrow owner-turn inputs are sent");
        var answer = transport.GetAsync(target, fixture.Thread, fixture.Turn).GetAwaiter().GetResult();
        check(answer.NodeId == fixture.Node && answer.ComputeTaskId == fixture.ComputeTaskId && answer.HardwareMode == "cpu-only" && answer.Content == "Fixture answer.", "a matching execution receipt permits display");
        var oldThread = transport.ListThreadsAsync(transport.SessionId).GetAwaiter().GetResult()[0];
        var oldTurn = transport.ListTurnsAsync(transport.SessionId, oldThread.ThreadId).GetAwaiter().GetResult()[0];
        check(oldTurn.TurnId == fixture.Turn && oldTurn.Target.NodeId == target.NodeId && oldTurn.Prompt == "History fixture", "remote history retains a recoverable turn key and original pin");
        transport.StopAsync(target, fixture.Thread, fixture.Turn).GetAwaiter().GetResult();
        fixture.ConfirmedStop = false;
        bool stopped = true;
        try { transport.StopAsync(target, fixture.Thread, fixture.Turn).GetAwaiter().GetResult(); }
        catch (InvalidOperationException) { stopped = false; }
        check(!stopped, "a still-pending response cannot confirm cancellation");
        fixture.SignedIn = false;
        try { transport.GetAsync(target, fixture.Thread, fixture.Turn).GetAwaiter().GetResult(); }
        catch (OwnerChatAuthorityException) { }
        check(transport.SessionId == null, "authority loss on receipt lookup invalidates the native account binding");
        fixture.SignedIn = true;
        fixture.CanStop = false;
        bool advertised = true;
        try { transport.DiscoverAsync().GetAwaiter().GetResult(); }
        catch (InvalidOperationException) { advertised = false; }
        check(!advertised, "a worker without durable stop support cannot be advertised");
        fixture.CanStop = true;
        transport.DiscoverAsync().GetAwaiter().GetResult();
        foreach (Action mutate in new Action[] {
            delegate { fixture.Served = "node_" + new string('b', 40); },
            delegate { fixture.Runtime = "qwen3:4b"; }, delegate { fixture.Hardware = "gpu-verified"; },
            delegate { fixture.ReturnedTurn = Guid.NewGuid().ToString(); }, delegate { fixture.ComputeTaskId = ""; } })
        {
            fixture.Served = fixture.Runtime = fixture.ReturnedTurn = null; fixture.Hardware = "cpu-only";
            mutate();
            bool refused = false;
            try { transport.GetAsync(target, fixture.Thread, fixture.Turn).GetAwaiter().GetResult(); }
            catch (InvalidOperationException) { refused = true; }
            check(refused, "a missing or mismatched serving receipt fails closed");
        }
    }
}
