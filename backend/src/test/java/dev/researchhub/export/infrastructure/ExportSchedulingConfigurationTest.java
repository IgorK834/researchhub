package dev.researchhub.export.infrastructure;

import java.time.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ExportSchedulingConfigurationTest {
    @Test void shutdownCancelsFutureTicksInsteadOfWaitingForTheirDeadline() {
        var scheduler=new ExportSchedulingConfiguration().exportScheduler();scheduler.initialize();
        var future=scheduler.schedule(()->fail("A future tick must not run during shutdown"),Instant.now().plusSeconds(3600));
        assertTimeoutPreemptively(Duration.ofSeconds(2),scheduler::destroy);
        assertTrue(future.isCancelled());
    }
    @Test void shutdownAllowsAnAlreadyRunningRenderToComplete() throws Exception {
        var scheduler=new ExportSchedulingConfiguration().exportScheduler();scheduler.initialize();
        var started=new CountDownLatch(1);var release=new CountDownLatch(1);
        var render=scheduler.schedule(()->{
            started.countDown();
            try {assertTrue(release.await(3,TimeUnit.SECONDS));}
            catch(InterruptedException interrupted) {throw new AssertionError("Active render was interrupted",interrupted);}
        },Instant.now());
        try(var executor=Executors.newSingleThreadExecutor()) {
            assertTrue(started.await(2,TimeUnit.SECONDS));var closing=executor.submit(scheduler::destroy);
            release.countDown();render.get(2,TimeUnit.SECONDS);closing.get(2,TimeUnit.SECONDS);
            assertFalse(render.isCancelled());
        } finally {release.countDown();scheduler.destroy();}
    }
}
